# Pokémon: distilling a Kaggle tool caller

Decision report | Updated November 13, 2026 | Research only; no application source changes. Compute, engineering effort and performance projections are **ESTIMATED**, not live measurements. Three-page deliverable.

## 1. Ranked choice and candidates

**Primary:** self-hosted **Qwen3-8B -> Qwen3-1.7B**, successful-trajectory SFT with NF4 QLoRA, followed by GGUF Q4_K_M export. This uses documented TRL/PEFT tooling and a smaller student, without running a teacher during training. It is a narrow-domain experiment, not a demonstrated replacement for a cloud planner.

**Fallback:** **Qwen3-14B -> Qwen3-4B**, the same method, if the primary teacher or student fails the development gate and the 14B teacher fits the actual T4 session. It trades potential capacity for memory and inference cost. Before generation, require the teacher to pass at least **16/20 development tasks** and beat untouched qwen3:4b by **2/20 tasks**. If neither teacher does, stop distillation and retain the baseline. These are proposed gates, not benchmark findings.

| Role | Checkpoint / weights license | Tool-use evidence | Memory and serving evidence |
| --- | --- | --- | --- |
| Primary teacher | [Qwen3-8B](https://huggingface.co/Qwen/Qwen3-8B/raw/main/README.md), 8.2B; Apache 2.0 | Vendor BFCL v3 **60.2**, non-thinking, report Table 18 | FP16 weights about **16.4 GB**, leaving insufficient practical headroom on one T4; [Ollama Q4_K_M](https://ollama.com/library/qwen3:8b) artifact **5.2 GB** |
| Fallback teacher | [Qwen3-14B](https://huggingface.co/Qwen/Qwen3-14B/raw/main/README.md), 14.8B; Apache 2.0 | Vendor BFCL v3 **61.5**, non-thinking, Table 16 | FP16 weights about **29.6 GB**, requiring sharding/offload; [Ollama Q4_K_M](https://ollama.com/library/qwen3:14b) **9.3 GB**, T4 fit conditional |
| Primary student | [Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B/raw/main/README.md), nominal 1.7B; Apache 2.0 | Vendor BFCL v3 **52.2**, non-thinking, Table 20 | Nominal FP16 weights **3.4 GB**; [Ollama Q4_K_M](https://ollama.com/library/qwen3:1.7b) **1.4 GB** |
| Fallback student / baseline family | [Qwen3-4B](https://huggingface.co/Qwen/Qwen3-4B/raw/main/README.md), 4.0B; Apache 2.0 | Vendor BFCL v3 **57.6**, non-thinking, Table 18 | FP16 weights **8.0 GB**; [Ollama Q4_K_M](https://ollama.com/library/qwen3:4b) **2.5 GB** |

Scores are vendor results from [Qwen3 Technical Report v1](https://arxiv.org/html/2505.09388v1), not Pokémon or quantized-model measurements. FP16 estimates use 2 bytes/parameter; downloads are not runtime VRAM. At 16,384 context, FP16 KV adds about **2.4 GB** for 8B / **2.7 GB** for 14B, plus buffers; measure fit. Ollama's 1.7B tag reports **2.03B**, unlike the HF card: pin HF revisions and exported GGUF digests.

The fetched [Apache 2.0 license](https://huggingface.co/Qwen/Qwen3-8B/raw/main/LICENSE) has no output-distillation prohibition; retain notices. Dataset rights remain separate. Self-host teachers; no hosted-service output terms are assumed. The four pinned tokenizer hashes match; cards document tool calling and Ollama support.

## 2. Kaggle limits and work BEFORE Day 1

The [Notebook docs](https://www.kaggle.com/docs/notebooks) list **T4 x2 / P100 / TPU 1VM**, CPU/GPU **12-hour** and TPU **9-hour** sessions, **20 GB** saved `/kaggle/working` and discarded scratch; GPU hosts have **29 GB RAM**. [T4 VRAM is 16 GB/device](https://www.nvidia.com/en-us/data-center/tesla-t4/), without automatic pooling. The [GPU guide](https://www.kaggle.com/docs/efficient-gpu-usage) states **30 hours/week, sometimes higher**. Account balance, two-T4 charging, TPU quota and availability are **UNVERIFIED**. Enable internet for training/tunnel; some competition submissions require it off.

Kaggle computes decisions/training; Windows executes native actions. Talk uses non-thinking, non-streamed Ollama `/api/chat`, **90-second** requests and at least **16,384 context**. Catalogs measure **5,505 B browser / 11,635 B course + 4,288 B instructions**; not token counts. Talk is disabled; its Excel catalog fails schema conversion. Existing web/Excel fixtures and agent tests can be extended.

| Pre-spike work | Ready when / scope | Engineer hours |
| --- | --- | --- |
| Excel schema prerequisite | Input JSON schema serializes; range validation, guarded writes and save tests pass | **4-8** |
| Enable Talk prerequisite | Restore UI/IPC/history and Ollama tool loop; test pause, handoff, errors and worker cleanup | **6-12** |
| Web fixture extension | Resettable synthetic pages, branches/paraphrases and independent fact verifiers | **6-10** |
| Excel fixture extension | Extend owned COM fixtures to 1/5/20 files; reset and verify calculations/reopened saves | **8-14** |
| Teams desktop fixture | Owned test tenant/accounts, fake contacts/messages, reset and recipient/body/persistence checks | **10-18** |
| Four-arm harness | Task/reset orchestration, existing cloud-client intake, MCP journals, timings, splits and export | **10-18** |
| Readiness verification | Integration tests; stale refs, timeout/pause/uncertain delivery; ten disposable smoke tasks | **6-10** |

**Fixture/harness/verification: 40-70 hours; Excel/Talk prerequisites: 10-20. Total: 50-90 + 25% contingency = 63-113 engineering hours**, including AI-code review/debugging. At six focused hours/day: **11-19 working days (about 2-4 weeks), before the seven-day spike**. Assumes licensed Windows Excel and an owned Teams test tenant; provisioning/login waits are extra. A simulator-only pilot does not verify real Teams. Finish schema/Talk first, integrate fixtures/harness, then pass readiness; **Day 1 starts only after this gate**. No built-in cloud-provider tool adapter is required: the control uses the existing external MCP client. This covers reusable preparation, not Kaggle compute or a production agent rewrite.

<!-- PAGEBREAK -->

## 3. Method decision

| Method | Cost / data | Risk and Kaggle fit | Decision |
| --- | --- | --- | --- |
| Verified SFT, LoRA/QLoRA | Store text trajectories; train the student alone. Proposed 60 successful training tasks in the spike | Teacher mistakes must be independently filtered. [TRL SFT](https://huggingface.co/docs/trl/v1.17.1/en/sft_trainer) supports messages, tool_calls, tool responses and a tools column. [NF4 QLoRA](https://huggingface.co/docs/transformers/en/quantization/bitsandbytes) supports T4/P100 | **First choice**: batch 1, gradient checkpointing, accumulation, assistant-only loss; validate actual loss masks |
| On-policy / logit distillation | Student rollouts plus teacher scoring; both models and logits, or staged scoring | [TRL GKD main](https://huggingface.co/docs/trl/main/en/gkd_trainer) is experimental. At 8,192 tokens x 151,936 vocabulary x 2 bytes, **one** full logit tensor is **2.49 GB**. Storing 2.95M positions is about **896 GB**, beyond saved storage. Online states need real observations | Defer; same tokenizer helps but does not solve memory or tool-loop integration |
| Rejection sampling / preferences | Try up to two fresh-reset candidates, retain verified successes; optional paired safe alternatives | Generation cost scales with attempts. [TRL DPO](https://huggingface.co/docs/trl/v1.17.1/en/dpo_trainer) adds preference/reference-model work; weak preference labels can reward wrong outcomes | Rejection filtering first; DPO only after a recurring error is demonstrated |
| Post-training quantization | Merge, convert and quantize; no extra teacher data | Quantization can alter argument accuracy. Validate merged and Q4 exports on development tasks before holdout | Required deployment step, not a distillation method or proven speedup |

For T4/P100 use compatible FP16 compute and a tested attention backend. Main [FlashAttention](https://raw.githubusercontent.com/Dao-AILab/flash-attention/main/README.md) targets Ampere or newer; it points T4 users to a separate implementation. Do not assume an A100 notebook recipe or BF16 acceleration transfers unchanged.

**Separate BitNet branch.** The released [microsoft/bitnet-b1.58-2B-4T-bf16](https://huggingface.co/microsoft/bitnet-b1.58-2B-4T-bf16/raw/main/README.md) supplies training/master weights; its [MIT license](https://huggingface.co/microsoft/bitnet-b1.58-2B-4T/raw/main/LICENSE) has no distillation prohibition. It reports about **2B parameters**, **4T pretraining tokens**, **4,096 context**, and a different LLaMA-3 tokenizer. Fine-tuning that released checkpoint is a permissible experiment. A proposed **3M processed-token** SFT probe at an assumed **80-180 tokens/s** costs **4.6-10.4 GPU hours**; this is neither measured throughput nor evidence that 3M tokens teaches tool use. A low-bit QAT probe from **Qwen3-1.7B** at **50-150 tokens/s** costs **5.6-16.7 hours**, before generation/evaluation. Either might fit a single-device weekly budget; both or double-charged sessions may not.

The fetched [torchao QAT example](https://pytorch.org/blog/quantization-aware-training/) is **int8 activation/int4 weight**, not ternary; its performance was measured on **6 A100s**, not T4. A mature ternary-QAT-to-Ollama recipe and packed-ternary T4/Ollama compatibility are **UNVERIFIED**. Microsoft's [GPU kernel instructions](https://raw.githubusercontent.com/microsoft/BitNet/main/gpu/README.md) do not establish T4 or Ollama support. Ordinary Transformers execution does not deliver the documented packed-kernel benefit. The 4,096 context is another mismatch with Talk's request. **No-go as the primary route.** Training 4T tokens from scratch, even at an optimistic 1,000 tokens/s, takes **1,111,111 GPU hours / 30 = 37,037 weeks**. That released pretraining budget is not a fine-tuning requirement.

## 4. Data plan and independent checks

Create synthetic web pages with known extraction answers, a Teams test tenant or owned simulator with fake users/messages, and disposable Excel sets of **1, 5 and 20 files**. Never generate sending trajectories against real recipients. A Windows fixture controller forwards bounded synthetic observations to the Kaggle teacher, validates the returned call, executes existing native guards, and independently checks the outcome. Preserve pauses, stale-reference handling and uncertain-delivery stops. Do not replay uncertain input.

Record user intent, catalog/schema hash, observations, tool arguments/results, final verifier and failure category. Verify exact scraped facts, intended recipient/body and persisted message in the owned fixture, and calculations/save paths by reopening workbook files. Successful prose or task_done alone is insufficient. Exclude wrong-target, unauthorized, injected-page-instruction, fabricated-success and ambiguous-delivery traces from positive SFT; retain them for evaluation/error analysis. Train explicit safe handoff examples separately. Replace ephemeral native IDs with the adapter's observed short targets; never fabricate an available target.

**Small spike:** 100 generation attempts, split into **80 training / 20 development tasks before generation**; budget assumes 60 training successes, about 360 decision windows. Reserve **60 new holdout tasks**, 20 per task family, with unseen templates, websites, identities and workbook sets. Split by task/environment, never randomly by adjacent turns. A later **500-2,000 successful-trajectory** target is a proposed learning-curve range, not a proven requirement; at the budget assumptions, training alone grows to **38-152 hours**. Start small and kill an ineffective approach. Tokenize real tools/history: use an 8,192 training cap only if essential context fits; **4,096 average tokens** below is an assumption, not permission to truncate evidence.

<!-- PAGEBREAK -->

## 5. Compute budget and go/no-go

**No live inference/training throughput was measured.** The table estimates one experiment with six model decisions/task, 96 output tokens/decision and average 4,096 input/training-window tokens. Prefill assumptions: teacher **1,500**, baseline **2,000**, student **2,500 tokens/s**; decode: **15 / 25 / 30 tokens/s** respectively. Replace all rates after day 1. Hours count accelerator allocation while waiting on Windows too.

| Stage | Arithmetic and assumptions | Estimated hours |
| --- | --- | --- |
| Generate 100 attempts | 600 x 4,096 / 1,500 / 3,600 prefill + 600 x 96 / 15 / 3,600 decode + 1 hour native/reset overhead | **2.52** |
| Train student, 2 epochs | 60 successes x 6 windows x 4,096 x 2 = **2,949,120 processed tokens**; / 180 tokens/s / 3,600 | **4.55** |
| Holdout, 3 Kaggle arms | 60 tasks x teacher/baseline/student; 360 decisions/arm; stated prefill/decode rates + 1.5 hours resets/verifiers | **3.49 GPU** |
| Cloud control, fourth arm | 60 tasks x (6 rounds x assumed 5-15 seconds + 15-30 seconds native/reset overhead) | **0.75-2.00 wall; 0 GPU** |
| Setup / export / quantization | Planning allowance, including model switching | **1.00** |
| Contingency | Baseline development gate, OOM, installs, checkpoints and short reruns | **1.50** |
| Total | **13.06 GPU / 26.12 quota hours if double-charged**; cloud adds 0.75-2 wall hours with Kaggle stopped | **Conditional** |

Budget excludes **63-113 pre-spike engineering hours**, operator time and cloud fees (measure actual usage; pricing **UNVERIFIED**). Stop Kaggle for the cloud arm; leaving it allocated raises double-charged total to **27.62-30.12 hours**. This covers the primary experiment only. At 80 training tokens/s, total becomes **18.75 / 37.50 hours**: over a double-charged quota. Stage 12-hour sessions/checkpoints; ongoing serving consumes quota.

**Four arms / 240 attempts:** A **current cloud client -> external Pokémon MCP**; B untouched qwen3:4b; C exported student; D teacher. Same 60 sealed tasks, once/arm, randomized/freshly reset. Freeze A's provider/model/version/settings and hash its prompt/catalog at preflight (**identity UNVERIFIED**). B-D share Talk schema/instructions, non-thinking, 16,384 context and 32-round cap; pin digests. A retains its existing client/MCP interface: **A-C compares systems; B-D compare models**. Cloud/local prompts and schemas differ. Exclude A's traces from training.

Use common task intent, native action families, guards and independent verifiers; **240-second deadlines**. Withhold answer keys/verifier source; non-MCP shortcuts violate protocol. Time from task admission, including client/approval/network gaps and failures. Report success, schema validity/tool selection with observable denominators, rounds, median/p95 round/outcome latency, native/verification time and cloud usage. Hidden cloud inference rounds/tokens are **N/A**. Compare end-to-end results across arms; include successful/all-attempt latency and cold/warm states.

**Proposed GO:** C passes **>=54/60**, no more than **one task fewer than B** overall or per family; call validity **>=99%**, tool selection **>=95%**; zero unauthorized/wrong-target/duplicate-input/false-completion events. C median round latency **<=80% of B**, median verified-outcome time **<=70%**, p95 **<=105%**, median rounds no higher. **Cloud replacement additionally requires** C no more than **one task fewer than A** overall/per family, median outcome time **<=80% of A**, p95 **<=105%**. Passing B alone does not justify replacing A. Assign failures the full deadline for all-attempt latency; report raw counts, paired uncertainty and limits of a 60-task pilot. On failure retain the appropriate control; any fallback uses development data and a fresh final holdout.

## 6. Export path and one-week spike

Reload the pinned full-precision HF student, attach LoRA and [PEFT merge_and_unload](https://huggingface.co/docs/peft/en/developer_guides/lora); save merged safetensors/tokenizer. Pin [llama.cpp's Qwen3 converter](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/conversion/qwen.py): convert_hf_to_gguf.py, then llama-quantize Q4_K_M. [Ollama import](https://docs.ollama.com/import) uses a Modelfile FROM that GGUF; import does not quantize. Preserve the tool template and validate /api/chat tool_calls.

Checkpoint adapters, optimizer/scheduler/RNG state, hashes and split manifests every **15-30 minutes**; retain two within the **20 GB** budget. Version private synthetic datasets; keep caches in scratch and essential checkpoints/export in `/kaggle/working`. Save/download durable outputs before session end, reserve conversion space, and resume checkpoints. Avoid Save & Run All accidentally repeating training.

Non-streamed Talk avoids SSE. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) are development-only, change hostnames, have no uptime guarantee and cap **200 in-flight requests**. Browser email authentication does not suit Ollama's client. Verify the endpoint; T4 rounds must fit the **90-second request timeout**.

**Before Day 1:** finish Section 2's readiness gate. **Day 1:** freeze cloud/local controls, confirm quota, tokenize catalogs and measure memory/rates on development fixtures. **Day 2:** teacher gate, select 8B/14B. **Day 3:** generate 80 training attempts, verify/filter. **Day 4:** 1.7B QLoRA, up to two epochs. **Day 5:** merge/export and Q4 development checks. **Day 6:** sealed 60-task **four-arm / 240-attempt** holdout; schedule cloud with Kaggle stopped. **Day 7:** counts, timings, cloud comparison and GO/NO-GO. A missed readiness gate shifts the whole spike; no implementation or deployment was performed here.

Source hashes, revisions, Kaggle readings, budgets and updated four-arm/pre-spike plan: [research evidence](../benchmarks/results/pokemon-distillation-kaggle-sources-2026-11-13.json). Local measurements: [catalog evidence](../benchmarks/results/pokemon-brain-catalog-2026-11-13.json). Public sources accessed November 13, 2026; benchmarks are vendor results.
