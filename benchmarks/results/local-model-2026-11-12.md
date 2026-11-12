# CPU local model comparison — 12 November 2026

The best measured replacement that preserves existing data is the current hashed-feature logistic ranker with sparse loops and one query-key list per request. It keeps all tested scores, rankings and feedback updates identical, introduces no production dependency, and reduces retrieval and update cost. It does **not** improve semantic understanding.

## Implemented

- Replace allocating key/value pair arrays with key loops for dot products and updates.
- Score the sparse query against accumulated weights, rather than scanning the weight union.
- Reuse query keys across context comparisons and predictions; extract task features once in preview/guide matching.
- Skip predictions for unreliable or insufficiently similar workflows.
- Withhold suggestions when learning is disabled. A regression test first reproduced the old behavior; disabling previously still returned an existing workflow.

The 2,048-feature space, normalization, 0.65 cosine gate, logistic update, feedback counters, version-1 journal and replay safeguards are unchanged. No migration is needed.

## Production before/after

Windows 10.0.26200, Intel i7-1165G7 @ 2.80 GHz, Node v22.12.0. Both builds run on the same machine with the same disposable encrypted snapshots. Each cell is the median of ten warm block averages, 100 lookups per block; p95 below is also across block averages, not individual-request tail latency. Alternating/reversed orders limit drift. The final run was separate from test runs.

| Workflows | Contexts each | Before ms/lookup | After ms/lookup |
| ---: | ---: | ---: | ---: |
| 1 | 1 | 0.02730 | 0.02577 |
| 1 | 8 | 0.06690 | 0.03210 |
| 8 | 1 | 0.10840 | 0.04012 |
| 8 | 8 | 0.45225 | 0.12252 |
| 32 | 1 | 0.35741 | 0.07952 |
| 32 | 8 | 1.71364 | 0.37990 |

At 32 workflows × 8 contexts, retrieval is **4.51× faster**, with block-average p95 **1.82345 → 0.42927 ms**. CPU for 1,000 lookups is **1,703 → 406 ms**. These are model/service measurements, not faster desktop actions or reduced cloud latency.

| Training measurement | Before ms/update | After ms/update | CPU before → after |
| --- | ---: | ---: | ---: |
| Precomputed features, 10,000 mixed-label updates | 0.033194 | 0.004168 | 328 → 78 ms |
| Feature extraction + update, 10,000 updates | 0.042925 | 0.018603 | 453 → 187 ms |

The precomputed update is **7.96× faster**. Feature extraction itself is unchanged: **0.01479 vs 0.01491 ms**. Baseline task seeding, including begin, receipt, finish, test feedback and encrypted persistence, takes **17.45 ms median**; no before/after persistence improvement is claimed. Test keys isolate the journal/model from DPAPI cost.

The 32-workflow, eight-context fixture serializes to **343,439 bytes**, including recent task records. Contexts and weights serialize to **259,013 bytes**. These are JSON sizes, not attributed heap sizes. The two-second idle check observed no writes and 0 ms process CPU at the timer's resolution; this is not proof of zero cost.

## Measured alternatives

The JavaScript candidates use a shared synchronous ranking harness, including feature extraction. They differ from production `suggest`, which also accesses the service. Compare these candidates within this table.

| Candidate, 32 × 8 | Median ms/lookup | Added buffers | Result |
| --- | ---: | ---: | --- |
| Sparse key list for each comparison | 0.53357 | No persistent cache | Avoid repeated key enumeration |
| Sparse query keys prepared once | 0.24101 | One temporary key list | Selected approach |
| Dense Float64, 2,048 slots | 0.87514 | 4,718,592 bytes | Slower, extra cache required |
| Context-only, prepared query keys | 0.24080 | One temporary key list | Similar speed, loses feedback ranking |

Dense training takes **0.01361 ms/update**, versus **0.00417 ms** for the selected sparse code. Float64 preserves scores but scans many zero slots. In a controlled equal-cosine tie, both still-eligible workflows score 1.0 on similarity; their feedback model scores are 0.79969 and 0.48017. Original and optimized ranking select the stronger-feedback workflow. Context-only falls back to insertion order and selects the weaker one. Removing the learner gives no useful speed benefit here.

A separate single-thread Python 3.13.1 trial actually runs Model2Vec and BM25; these are not estimated upstream speed claims. Python/NumPy and Node have different runtimes and implementations, so the timings do not isolate algorithm differences or include a production bridge.

| Research candidate | Median measured cost | Memory/index cost |
| --- | ---: | --- |
| Model2Vec potion-base-8M, encoding + 32 × 8 ranking | 0.12169 ms/lookup | 30,236,672-byte embedding table; 590,080-byte context/head buffers |
| Model2Vec encoding only | 0.07060 ms/query | 256 dimensions, 29,528 token vectors |
| Logistic head update on static vectors | 0.00912 ms/update | 256 precomputed examples seeded in 2.82 ms |
| Encoding + logistic head update | 0.09234 ms/update | Frozen pretrained table; no fine-tuning |
| BM25Okapi, 256 contexts | 0.16033 ms/lookup | Index construction 2.31 ms |

The static model loads locally in **114.25 ms**, excluding Python startup/imports and download. Model files are about 30.9 MB, excluding the runtime and packages. The pretrained model revision and file hashes are recorded. Its base package runs without Torch; this trial does not measure distillation or embedding fine-tuning.

## Effectiveness and failure cases

The same 94 held-out synthetic cases cover familiar phrasing, semantic paraphrases, negation, different actions and unrelated tasks. Expected rejection is scored as correct only if there is no suggestion. No cutoff was tuned on these cases.

| Group | Original / optimized sparse | Dense / context-only | Static, diagnostic 0.65 gate | BM25, experimental score > 0 |
| --- | ---: | ---: | ---: | ---: |
| Familiar supported phrasing | 64/64 | 64/64 | 63/64 | 64/64 |
| Semantic paraphrases | 0/8 | 0/8 | 0/8 | 0/8 |
| Reject negated requests | 0/8 | 0/8 | 0/8 | 0/8 |
| Reject a different action on the same field | 0/8 | 0/8 | 0/8 | 0/8 |
| Reject unrelated requests | 6/6 | 6/6 | 6/6 | 6/6 |

All production before/after scores and orderings are exactly equal on the workload and evaluation queries. Model weights, bias and example counts remain exactly equal after varied mixed-label updates. Existing encrypted version-1 snapshots reopen unchanged under both builds.

Static embeddings rank **5/8 semantic paraphrases correctly before filtering**, such as “Update the stock count” → inventory. However, those matches lie below 0.65. Reusing the sparse cutoff prevents that gain. Diagnostic cutoffs of 0.75, 0.85 and 0.90 increasingly reject valid phrasings while still accepting all eight negated requests. BM25 uses a different score scale and also lacks an adequate rejection rule here.

These failures are material: this component retrieves plausible workflows; it does not decide current intent. “Do not type the invoice field” must never authorize the suggested typing plan. The existing client review of current intent and fresh target discovery remain necessary. This optimization preserves those boundaries; it does not solve negation.

## Repository research and decision

Primary sources reviewed on 12 November 2026:

- [River logistic regression](https://github.com/online-ml/river/blob/main/river/linear_model/log_reg.py) and [feature extraction](https://github.com/online-ml/river/blob/main/river/feature_extraction/vectorize.py): sparse dictionaries and per-example updates fit this bounded, feedback-driven workload. Keep that architecture and remove repeated allocation.
- [scikit-learn incremental text classification](https://scikit-learn.org/stable/auto_examples/applications/plot_out_of_core_classification.html): hashing avoids fitting a changing vocabulary; incremental SGD avoids full retraining.
- [Model2Vec source](https://github.com/MinishLab/model2vec/blob/main/model2vec/model.py): tokenizer lookup plus mean pooling is a credible CPU semantic candidate. The tested English model uses revision `bf8b056651a2c21b8d2565580b8569da283cab23`. It needs separate calibration, multilingual cases, storage migration and deployment cost checks before integration.
- [rank_bm25 source](https://github.com/dorianbrown/rank_bm25/blob/master/rank_bm25.py): corpus term counts and IDF support cheap lexical ranking. It needs corpus rebuilding and a new acceptance rule; saved normalized hashed vectors cannot recover original token counts.
- [fastText](https://github.com/facebookresearch/fastText) and its [supervised tutorial](https://fasttext.cc/docs/en/supervised-tutorial.html): compact native supervised classification is an option with a representative labeled corpus. The upstream repository is archived; no native build or training benchmark was run.
- [Sentence Transformers](https://github.com/huggingface/sentence-transformers) and [CPU efficiency guidance](https://www.sbert.net/docs/sentence_transformer/usage/efficiency.html): ONNX/OpenVINO and quantization are options for contextual embeddings. No transformer model was downloaded or timed; larger runtimes and training costs are unproven for this tiny store.

Keep optimized sparse matching as the default now. The next semantic experiment should test calibrated static embeddings on a separate training/validation/test split with English/Vietnamese requests and hard action/negation negatives. The present synthetic test cannot establish that deployment is worthwhile.

## Verification and reproduction

Backend build passes; **306 backend tests pass, one existing test is skipped**. Changed learning files pass lint. The built MCP learning contract smoke passes. Model checks include feedback correction, journal restart, DPAPI persistence, disabled reuse, preview and guide guards. Native UI execution, full frontend/package checks and transformer fine-tuning were not repeated for this model-only change.

Raw blocks, evaluation cases, CPU counts, memory observations and build hashes: [local-model JSON](local-model-2026-11-12.json), [static-model JSON](static-model-2026-11-12.json). Historical November 11 benchmarks were preserved and are not used as this run's baseline.

After building, run `node scripts/local-model-benchmark.mjs --baseline <saved-project-root>`. The baseline must contain its original `backend/dist` and resolvable backend dependencies. This session used `%LOCALAPPDATA%/Temp/pokemon-local-model-before-20261112`.

For the research-only Python script, use a separate environment with the recorded packages: `model2vec==0.10.0`, `numpy==2.5.4`, `rank-bm25==0.2.2`, `tokenizers==0.23.3`, `huggingface-hub==2.4.0`. Run `python scripts/static-model-benchmark.py --model-dir <separate-model-directory>` after the Node benchmark. The script downloads only the pinned public model files, uses synthetic text, and does not change application dependencies or access the user's learning profile.
