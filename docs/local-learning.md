# Local workflow learning

Pokémon Companion uses a small online logistic ranker and a bounded workflow library. It learns from observed operations and explicit feedback, without a downloaded generative model, a neural runtime, GPU allocation or background training. Its text features are 2,048 hashed words/character trigrams with diacritic normalization and a few English/Vietnamese verb aliases. This supports familiar phrasing, not general multilingual semantic understanding.

## Client workflow

1. Read `learning status` once per session. When enabled, call `begin` with the verbatim current user query and named current parameters such as `window` and `text`. Recognizable credentials are redacted before persistence.
2. Propagate its `task_id` to task tools. Existing atomic/batch behavior and schema refinements stay in place; task attribution is stripped before invoking the original handler.
3. `begin` returns up to three sufficiently similar, reliable workflows. A Windows workflow can be `preview`ed with current parameters. Check the concrete plan against current intent, then `run` its single-use preview. This review is the client's responsibility and does not require another user approval when existing authorization covers it.
4. A mixed-tool task produces a process guide. Call `use_guide`, then perform its API sequence using current observations and judgment. The guide contains API names, not saved shell commands or executable generated code.
5. Wait for every tool result, verify the actual requested outcome, and call `finish` with `met`, `unmet` or `unknown`. A delivered click is not proof of task completion.
6. Leave satisfaction `unknown` until the user rates the task. Clicking the Pokémon opens **Yes**/**No** feedback. The authenticated bridge confirms only after encrypted persistence. `feedback` is also available for a clear, explicit user report. Test ratings are synthetic and confined to disposable profiles.

Successful, explicitly satisfactory tasks create/update workflows and train positive examples. API failures, unmet outcomes and negative ratings reduce reliability and train negative examples for a known workflow. Duplicate ratings do not add examples; changing a rating adjusts success/failure counts and adds a corrective model update. Up to eight successful query contexts per workflow improve retrieval of newly learned phrasing. Similarity and model scores are heuristics, not calibrated success probabilities.

Matching also checks a small English/Vietnamese action and negation vocabulary, and retains up to eight rejected query vectors per workflow. A very close rejected context prevents reuse when it matches at least as well as successful contexts; it cannot silently promote a poorer match. Positive feedback correction removes the corresponding rejected context. Current intent checks apply to suggestions, previews and guides, and issued previews are rechecked before use. Unknown phrasing still requires client review. See the [November 13 improvements and comparison](local-ranker-improvements.md): all 80 tested incorrect-reuse cases were rejected, while all 104 supported positive cases retained their original scores and order. Eight unlearned semantic paraphrases remain unsupported.

## Replay limits

Executable recipes contain 1–16 sequential Windows steps, start with specific window discovery, and end with a value check. Atomic sequences are compiled only when their original references can be traced back to unique discovery calls. Each replay obtains fresh windows and snapshots; no saved native handles, snapshots, coordinate clicks or shell launches are executed. Entered values must be named current parameters. Ambiguous bindings, redacted secrets, unsafe steps and incomplete sequences prevent compilation. Unsupported or mixed-tool operations become guides.

Previews expire after two minutes, belong to one current task and can be consumed once. The original Windows batch runner retains ambiguity, truncation, stale-reference, foreground, pause and cancellation checks. Failure stops at the first failing step and reports completed steps; inputs are never automatically retried or rolled back. A final field value proves that field's value, not unrelated side effects. The client must independently assess the user's requested outcome.

Screenshots remain available when visual content has no usable accessibility/object-model representation, including canvases, custom controls and charts. Use native APIs first, known direct keyboard shortcuts next, and screenshots only as needed. APIs can expose only the information provided by the application and allowed by OS access controls. Screenshot pixels are not learning data, and the local text ranker cannot interpret them.

## Privacy and controls

The encrypted journal uses AES-256-GCM. Windows protects the random key with current-user DPAPI through the existing native worker; other platforms use owner-only key files. No learning uploads or provider calls occur. Task records include redacted queries, named parameters, API names, per-tool duration, success/failure and delivery evidence, declared observed outcomes, and satisfaction with its source. Recognizable tokens/passwords are redacted; generic sensitive prose cannot be reliably recognized, so disable collection for sensitive tasks.

The default profile is local app-data `pokemon-companion/learning`. `POKEMON_LEARNING_DIR` selects a separate profile. One live process owns each profile, with stale-owner checks and integrity failures reported rather than ignored. Logging failure cannot change a tool's already delivered action result; `status.recording_error` reports it. Basic tools without a `task_id` can continue without learning.

Limits are 32 recent tasks, 32 workflows, 64 retained receipts per task, approximately 2 MiB projected state, 4 MiB journal compaction and an 8 MiB journal read cap. Default retention is 30 days and can be configured to 1–365 days. Retention runs on writes and on access at most once per minute, not via an idle timer. Expired raw records are removed on the next access/write. Recently used workflow knowledge may retain older derived weights/feature contexts; API totals are anonymous lifetime aggregates until `forget`.

- `configure`: supply `enabled` and `retention_days`. Disabling invalidates previews. `POKEMON_LEARNING=off` also disables collection and reuse.
- `forget`: rewrites the journal with empty task, workflow, weight and aggregate state. The encryption key remains. This is logical deletion; filesystem backups and SSD behavior are outside the service's control.
- `export`: returns one compact text response containing JSON chunks, within `max_chars` (1,000–16,000, default 8,000). Start at offset 0; concatenate each `data` value using `next_offset` and the original `version`, then parse the concatenation as JSON. A changed version requires restarting. Export is decrypted data requested by the client; it does not create a plaintext file.

Stdio needs no HTTP token. HTTP binds to `127.0.0.1` and requires `POKEMON_HTTP_TOKEN` of at least 32 characters. Clients send `Authorization: Bearer <token>`; authentication runs before JSON parsing. `scripts/start-http.ps1` stores only a DPAPI-protected token and starts the Windows server without printing it. The companion bridge has a separate per-process random token.

## Resource choices and evidence

The [November 12 local-model comparison](../benchmarks/results/local-model-2026-11-12.md) measures sparse scoring, dense arrays, context-only ranking, Model2Vec and BM25 on the same synthetic workflow corpus. The selected sparse implementation preserves existing journal data and exact tested scores while reducing CPU cost. Semantic paraphrases, negation and different-action requests expose retrieval limits; matching still requires current-intent review. The report separates measured alternatives from researched-only options and includes reproducible scripts and raw samples.

Idle wandering/GIF playback is off by default: the companion uses a still idle sprite and preserves animations for actual work and travel. `POKEMON_IDLE_ANIMATION=on` restores continuous idle animation. Unchanged window shapes and tray menus are cached; hidden windows skip motion/layout polling. `POKEMON_UI=off` avoids Electron entirely for explicitly headless use. Hardware acceleration remains available for work animations; disabling it globally can move work to the CPU.

Measurements on Windows, Intel i5-8500T, Node 24.16.0:

| Measurement | Result | Scope |
| --- | --- | --- |
| Native six-call recorded execution | 4,320.71 ms median, four runs | Owned WinForms fixture, overlay off |
| Learned one-call batch execution | 4,086.51 ms median, four runs | Same six operations, fresh discovery after restart |
| Replay planning | See individual samples | `begin` plus `preview`; external AI latency excluded |
| Protected store opening | 27.91 ms | Existing Windows worker/DPAPI; worker/server startup was 5.06 s |
| Retrieval at 32 workflows | 0.43 ms median, 0.79 ms p95 | 500 synthetic lookups |
| Incremental ranker update | 0.013 ms median | 2,000 CPU-only updates, persistence excluded |
| Recorded diagnostics call | 2.18 ms median, 3.40 ms p95 | 200 calls including encrypted journal overhead |
| Seed/train one workflow | 6.73 ms median | Query, four-step receipt, finish and test rating |
| Projected bounded dataset | 132,989 bytes | 32 workflows; Node RSS/heap are reported separately |

Eight successful native executions were independently verified against fixture state. A deliberately missing button stopped at step 4 after four completed steps, without an extra click; its satisfaction remained unknown. Restarted replay retained learned weights and discarded native snapshots. Four positive held-out phrasings selected the correct workflow; two unrelated requests returned no workflow. These six cases are a small test, not a claim of general accuracy.

The final integration run's execution medians differ by about 5.4% in this fixture; an earlier run showed about 8.2%, illustrating measurement variation. Native scanning still dominates, and existing batch mode already executes the same operations in one call. Learning primarily saves repeated workflow planning; no external AI latency, general speedup or token-cost reduction was measured. Concurrent MCP calls alone were not faster in the earlier parallel experiment, so a production parallel worker pool was not added.

Full samples and limitations are in `benchmarks/results/local-learning-native-2026-11-11.json`, `local-learning-resources-2026-11-11.json`, and the `local-learning-ui-*-2026-11-11.json` reports. Electron metrics report CPU used by its GPU process, not hardware GPU utilization. The idle samples are short and include the test harness; process CPU timers have finite resolution, so a zero reading is not a zero-cost claim. Electron still has substantial baseline memory cost.

The final default-idle sample reported 0.20% browser, 0.09% renderer and 0.02% GPU-process CPU; a separate animated-idle run reported 0.64%, 1.61% and 3.07%. These short samples demonstrate why continuous idle animation is optional, not a universal reduction percentage. A separate Windows WMI GPU-engine snapshot for the running default-idle companion reported zero on each observed engine; it is one instantaneous sample, not a hardware-utilization average. See `local-learning-live-gpu-2026-11-11.json`.

Reproduce after `npm run build`: `npm run test:learning` for native replay, both production feedback buttons and HTTP auth; `npm run benchmark:learning` for model/journal measurements. `npm test` covers model, privacy, attribution, schemas and existing behavior. The tests use owned fixtures and disposable encrypted profiles.
