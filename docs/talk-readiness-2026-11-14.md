# Companion Talk readiness — 2026-11-14

This readiness change fixes the two implementation prerequisites: Excel input-schema export and the companion's Talk UI/IPC path. The seven-day training/evaluation spike has not started. The full sealed holdout and real Teams fixture remain to be built.

The implementation is in draft [PR #19](https://github.com/Minsun1503/pokemon-companion/pull/19). Talk uses the existing Ollama agent prompt, options and native worker. Excel exports input JSON schemas while keeping runtime range validation. Chat IPC accepts owned companion main frames, keeps each pet's history separate, propagates pause and closes the lazy worker when the companion exits.

## Completed checks

- Build and lint/type checks passed.
- 342 backend tests passed, one skipped; 71 root tests passed.
- The actual Electron main/preload/renderer fixture passed Talk opening, history isolation, rejection of unowned IPC, native text entry, pause rejection and worker cleanup. This fixture also runs in Windows CI.
- Windows CI passed for implementation commit `f7835542e1c2973b876b0c4377be9c8abf50d5d2`.
- The live runner now saves model/tool traces incrementally with atomic replacement. An owned interrupted-request check verified that a pending request survives worker termination; this harness check is not a live model result.

## External cloud control

The current external cloud MCP client completed all ten disposable tasks with verified outcomes. Eight passed directly; document passages and actual PDF reading required read recovery. Failures and recovery evidence are retained in [the cloud results](../benchmarks/results/talk-readiness-cloud-2026-11-14.json).

| Task | Cloud outcome |
| --- | --- |
| Window discovery | Verified title |
| Control discovery | Verified input supports `set_value`; left empty |
| Text entry/readback | Exact synthetic text verified |
| Search/open result | Opened result; read 37 cases and 48.75 USD |
| Button/result | Read Active status and the record key |
| Document passages | Verified facts after read recovery |
| Open URL | Exact URL and document title verified |
| Open/read actual PDF | Verified invoice facts after read recovery |
| Excel read | Read values 1–10; sentinel workbook untouched |
| Excel write/calculate/save | Reopened formula `=SUM(A2:J2)` returned 55; sentinel untouched |

One fixture closed unexpectedly during PDF work. Actual browser PDF text still established the PDF result; later fixture/recovery tasks used a second disposable fixture. These interruptions remain in the record.

This is one unblinded smoke sample per task. The external client uses its full MCP catalog; Talk uses its existing smaller catalog. The cloud model/settings identity was not frozen for this smoke run. Cloud `elapsed_ms` includes setup, client gaps and fixture interruption, so it must not be compared with local runner timing. These results establish neither model equivalence nor a speedup.

## Local runtime and live model

The official Windows standalone CPU runtime, Ollama `0.40.16`, is installed at `D:/Ollama/cpu/ollama.exe`; its Authenticode signature is valid for Ollama Inc. GPU libraries were omitted because this machine has no discrete GPU. Model storage is `D:/Ollama/models`. The companion's saved settings use `http://localhost:11434` and `qwen3:4b`.

The already-connected MCP server and its pet UI predate this build. A host reconnect is needed to load the updated main/renderer. The owned Electron integration check exercises a fresh build; it does not reload the existing host session.

The stock model installation is in progress. Only a complete model matching the official manifest's SHA-256 is accepted:

`3e4cb14174460404e7a233e531675303b2fbf7749c02f91864fe311ab6344e4f` (2,497,280,480 bytes).

The [live runner](../scripts/talk-readiness-local.mjs) executes the real `CompanionChat` and `CompanionAgentTools`, gives each task a fresh profile/worker, and records model requests, token counts, durations, selected tool calls and failures. Each task has a 180-second deadline; the existing model request timeout remains 90 seconds. Passing requires both independent fixture verification and a verified `task_done`. Live results are pending; mocked UI checks do not count as model outcomes.

## Gate before Day 1

The original preparation estimate was **63–113 engineering hours**, including contingency, or **11–19 working days at six focused hours/day**. Excel/Talk prerequisites accounted for 10–20 hours before contingency. Those source prerequisites now have implementation evidence; the disposable smoke fixture is only part of the planned fixture work.

The remaining full fixture/harness scope was estimated at **40–70 engineering hours before contingency**: web branches/paraphrases, Excel sets of 1/5/20 files, an owned Teams tenant/accounts or explicitly labelled simulator pilot, resets, independent recipient/body/persistence checks, trace/filtering and sealed four-arm holdout integration. Some basic web/Excel smoke plumbing now exists, but its completion does not establish how much of that estimate can be removed. Provisioning/authentication waits are additional.

Keep the current cloud client as control arm A, untouched qwen3:4b as B, exported student as C and teacher as D. Freeze A's provider/model/version/settings and prompt/catalog identity at preflight. B–D share Talk's interface; A retains its existing external client interface. A–C compares systems; B–D compares models. Exclude A's traces from training.

Day 1 begins after the full readiness gate: verified local baseline runs, resettable owned fixtures, independent verifiers, pinned identities and a sealed holdout. Keep the cloud client available while the local baseline and fixture gate are evaluated.
