"""Research-only CPU comparison; run in an isolated Python environment, not the app."""
import os
os.environ.update(OPENBLAS_NUM_THREADS="1", OMP_NUM_THREADS="1", MKL_NUM_THREADS="1", TOKENIZERS_PARALLELISM="false", HF_HUB_DISABLE_XET="1")

import argparse
import hashlib
import importlib.metadata
import json
import platform
import re
import statistics
import time
import unicodedata
from pathlib import Path

import numpy as np
from huggingface_hub import snapshot_download
from model2vec import StaticModel
from rank_bm25 import BM25Okapi

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--model-dir", type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
source = root / "benchmarks/results/local-model-2026-11-12.json"
fixture = json.loads(source.read_text(encoding="utf-8"))
topics = fixture["fixture"]["topics"]
texts = [text for phrases in fixture["fixture"]["phrases"] for text in phrases]
cases = [{k: row[k] for k in ("group", "query", "expected")} for row in fixture["evaluation"]]
assert len(cases) == 94

def tokens(text):
    text = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)).lower()
    for pattern, replacement in [(r"\b(?:launch|start|mo)\b", "open"), (r"\b(?:find|tim)\b", "search"), (r"\b(?:enter|fill|nhap)\b", "type")]:
        text = re.sub(pattern, replacement, text)
    return re.sub(r"[^\w]+", " ", text).split()[:128]

def measure(run, count=100, blocks=10):
    for i in range(100):
        run(i)
    samples = []
    for _ in range(blocks):
        start, cpu = time.perf_counter(), time.process_time()
        for i in range(count):
            run(i)
        samples.append({"ms": (time.perf_counter() - start) * 1000 / count, "cpu_ms": (time.process_time() - cpu) * 1000, "operations": count})
    values = sorted(row["ms"] for row in samples)
    return {"runs": blocks, "median_ms": statistics.median(values), "p95_ms": float(np.quantile(values, .95)), "cpu_ms": sum(row["cpu_ms"] for row in samples), "samples": samples}

def train(weights, bias, vector, label):
    score = 1 / (1 + np.exp(-np.clip(bias + weights @ vector, -20, 20)))
    gradient = (label - score) * .4
    weights *= .999
    weights += gradient * vector
    return float(np.clip(bias + gradient, -4, 4))

model_id = "minishlab/potion-base-8M"
start = time.perf_counter()
revision = "bf8b056651a2c21b8d2565580b8569da283cab23"
snapshot_download(model_id, revision=revision, local_dir=args.model_dir, allow_patterns=["config.json", "tokenizer.json", "model.safetensors", "README.md"])
download_ms = (time.perf_counter() - start) * 1000
start = time.perf_counter()
model = StaticModel.from_pretrained(str(args.model_dir), normalize=True)
load_ms = (time.perf_counter() - start) * 1000
vectors = model.encode(texts, use_multiprocessing=False).astype(np.float64)
assert vectors.shape[0] == 256 and np.isfinite(vectors).all()
assert np.allclose(np.linalg.norm(vectors, axis=1), 1, atol=1e-5)
contexts = vectors.reshape(32, 8, -1)
weights, biases = np.zeros((32, model.dim)), np.zeros(32)
start = time.perf_counter()
for recipe in range(32):
    for vector in contexts[recipe]:
        biases[recipe] = train(weights[recipe], biases[recipe], vector, 1)
head_seed_ms = (time.perf_counter() - start) * 1000

def static_rank(query):
    vector = model.encode([query], use_multiprocessing=False)[0].astype(np.float64)
    match = (vectors @ vector).reshape(32, 8).max(axis=1)
    prediction = 1 / (1 + np.exp(-np.clip(biases + weights @ vector, -20, 20)))
    order = np.argsort(-(match + prediction * .2), kind="stable")
    return [(topics[int(index)], float(match[index])) for index in order]

start = time.perf_counter()
bm25 = BM25Okapi([tokens(text) for text in texts])
bm25_index_ms = (time.perf_counter() - start) * 1000
def bm25_rank(query):
    scores = bm25.get_scores(tokens(query)).reshape(32, 8).max(axis=1)
    order = np.argsort(-scores, kind="stable")
    return [(topics[int(index)], float(scores[index])) for index in order]

# Predeclared diagnostic cutoffs: none is selected by tuning on these test cases.
cutoffs = [.65, .75, .85, .9]
evaluation = []
for item in cases:
    static, lexical = static_rank(item["query"]), bm25_rank(item["query"])
    static_top = {str(cutoff): next((topic for topic, score in static if score >= cutoff), None) for cutoff in cutoffs}
    bm25_top = lexical[0][0] if lexical[0][1] > 0 else None
    evaluation.append({**item, "static_top1_without_cutoff": static[0][0], "static_at_cutoffs": static_top, "static_ranked": static[:3], "bm25_positive_score": bm25_top, "bm25_ranked": lexical[:3]})

groups = list(dict.fromkeys(item["group"] for item in cases))
quality = {}
for cutoff in cutoffs:
    quality["static_" + str(cutoff)] = {group: {"correct": sum(row["static_at_cutoffs"][str(cutoff)] == row["expected"] for row in evaluation if row["group"] == group), "total": sum(row["group"] == group for row in evaluation)} for group in groups}
quality["bm25_positive_score"] = {group: {"correct": sum(row["bm25_positive_score"] == row["expected"] for row in evaluation if row["group"] == group), "total": sum(row["group"] == group for row in evaluation)} for group in groups}
quality["static_positive_top1_no_cutoff"] = {group: {"correct": sum(row["static_top1_without_cutoff"] == row["expected"] for row in evaluation if row["group"] == group), "total": sum(row["group"] == group for row in evaluation)} for group in groups if any(row["group"] == group and row["expected"] is not None for row in evaluation)}

queries = [row["query"] for row in cases]
encoding = measure(lambda i: model.encode([queries[i % len(queries)]], use_multiprocessing=False), 1000)
static_retrieval = measure(lambda i: static_rank(queries[i % len(queries)]))
bm25_retrieval = measure(lambda i: bm25_rank(queries[i % len(queries)]))
head_weights, head_bias = np.zeros(model.dim), [0.]
def head_update(i):
    head_bias[0] = train(head_weights, head_bias[0], vectors[i % len(vectors)], i % 3 != 0)
head_training = measure(head_update, 1000)
def full_update(i):
    vector = model.encode([queries[i % len(queries)]], use_multiprocessing=False)[0].astype(np.float64)
    head_bias[0] = train(head_weights, head_bias[0], vector, i % 3 != 0)
training_with_encoding = measure(full_update, 1000)
assert np.isfinite(head_weights).all() and np.isfinite(head_bias[0])
assert static_rank(texts[0])[0][0] == topics[0]
files = {p.name: {"bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in args.model_dir.iterdir() if p.is_file()}
report = {"created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "environment": {"python": platform.python_version(), "os": platform.platform(), "cpu": fixture["environment"]["cpu"], "threads": 1, "packages": {name: importlib.metadata.version(name) for name in ["model2vec", "numpy", "rank-bm25", "tokenizers", "huggingface-hub"]}}, "source_fixture_sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "model": {"id": model_id, "revision": revision, "dimensions": model.dim, "vocabulary": len(model.tokens), "embedding_bytes": model.embedding.nbytes, "context_and_head_bytes": vectors.nbytes + weights.nbytes + biases.nbytes, "files": files, "download_or_cache_ms": download_ms, "local_load_ms": load_ms}, "head_seed_256_examples_ms": head_seed_ms, "bm25_index_256_contexts_ms": bm25_index_ms, "encoding": encoding, "static_retrieval": static_retrieval, "bm25_retrieval": bm25_retrieval, "online_head_update": head_training, "training_with_encoding": training_with_encoding, "quality": quality, "evaluation": evaluation, "limits": ["Research-only Python process, no Node bridge, app packaging or encrypted journal cost measured; compare quality on the shared fixture, not Python/Node timing as algorithm-only speed.", "Frozen pretrained English embeddings, only the existing logistic head algorithm is trained; distillation/fine-tuning are not timed.", "Cutoffs were declared before evaluation and are diagnostic, not calibrated for this model. BM25 > 0 is an experimental acceptance rule with incompatible score scale; no production migration is proposed.", "Same synthetic 94-case fixture, not a real user dataset or multilingual validation. No model can authorize actions; negation/different-action failures require client intent review.", "Embedding/context buffer and file byte counts are exact; they exclude Python runtime, tokenizer, package and bridge memory.", "Ten warm blocks per metric; p95 is of block averages, CPU includes harness. Single-thread configuration, no GPU and no multiprocessing."]}
output = root / "benchmarks/results/static-model-2026-11-12.json"
output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"model": report["model"], "static_retrieval_ms": static_retrieval["median_ms"], "bm25_retrieval_ms": bm25_retrieval["median_ms"], "head_update_ms": head_training["median_ms"], "quality": quality, "output": str(output)}, indent=2))
