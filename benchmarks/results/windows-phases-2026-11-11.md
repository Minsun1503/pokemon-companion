# Claude-guided native automation experiment

Claude reviewed the existing results in [this Edge conversation](https://claude.ai/chat/f2e0f0d6-ea77-433b-8cc4-5d44fedfebd5). Its priority was per-phase profiling before choosing an optimization. The consultation and all owned application interaction used Pokémon MCP. Claude had not inspected the unpublished source; its response is advice, not repository instructions.

Profiling found that managed UIA navigation/cache requests dominated the six-step WinForms workflow. The original traversal made 420 such requests and five complete tree walks. Fresh per-parent Control View child caches reduced that count to 215 while retaining all five walks and the same identity/uniqueness/ancestor checks. Full-tree scanning was not replaced with a first-match lookup.

## Controlled results

Windows, i5-8500T, Node 24.16.0. Warm local execution with overlay disabled. Both cache arms used the same compiled worker under a feature flag; each cache comparison used 15 ABBA blocks, 30 samples per arm. The workflow-mode comparison used 30 counterbalanced samples per mode on one warm server.

| Workload / mode | Runs | Median ms | Q1–Q3 ms |
| --- | ---: | ---: | ---: |
| 30 values, original traversal | 30 | 623.4 | 599.4–637.0 |
| 30 values, child caches | 30 | 555.6 | 537.3–572.1 |
| Six-step workflow, original traversal | 30 | 3205.0 | 3182.9–3260.9 |
| Six-step workflow, child caches | 30 | 2868.8 | 2841.1–2933.8 |
| Controlled atomic_unrecorded | 30 | 2922.4 | 2863.4–2963.8 |
| Controlled atomic_recorded | 30 | 2927.1 | 2887.0–2955.6 |
| Controlled batch | 30 | 2914.7 | 2868.2–2940.0 |
| Controlled learned_replay | 30 | 2908.7 | 2865.1–2918.0 |

The direct six-step cache comparison lowered median time by **10.5%**. The median paired saving was 344.5 ms; the seeded 10,000-resample bootstrap 95% interval was 308.7–393.6 ms. The read-only comparison lowered median time by 10.9%. These are separate measurements, not comparisons with the old four-run report.

Batch and learned replay confidence intervals against unrecorded atomic calls included zero in the workflow-mode run. Their local native speed differences are not established by that comparison. They still execute six steps through one workflow MCP call instead of six; external AI turn latency and costs were not measured. Recorded atomic calls had a negative paired saving interval (additional overhead), reported in the raw data.

Every read value and every workflow text/click count was independently verified. Startup and warmup were excluded from warm latency; startup is recorded separately in the JSON. Begin, preview, finish, feedback, and independent state verification are outside the workflow timer. Synthetic explicit ratings were used only in disposable learning stores.

## Evidence and limits

- [Controlled raw samples and phase/counter summaries](windows-phases-controlled-2026-11-11.json)
- [Direct workflow cache ABBA samples](windows-phases-workflow-cache-2026-11-11.json)
- [Initial phase pilot](windows-phases-pilot-2026-11-11.json)
- [Later replay timing integration pilot](windows-phases-replay-profile-2026-11-11.json)
- [Changed-control safety checks](windows-child-cache-safety-2026-11-11.json)
- [Profiling, flags, safeguards and reproduction](../../docs/native-profiling.md)

Native binary hashes are recorded in each measured report. Later changes enabled the measured cache traversal by default, added a pure action phase to exported timing, and wrapped learning calls in a timing context. The controlled replay run predates that wrapper and has no exported replay phase breakdown; the later three-run pilot verifies its presence and is not used to estimate performance.

Phase names ending in inclusive overlap and must not be summed. Counts measure managed API invocations, not internal provider RPCs. Both cache arms had native profiling enabled; profiler-off overhead was not estimated. WinForms latency does not establish gains in Edge, Electron, WPF or other providers. WinForms/Electron identity and subtree smoke tests are compatibility/safety checks, not application speed benchmarks. No ranker calibration study, external model measurement, or ten-minute CPU/GPU study was added in this experiment.

## Final verification

The production default passed 204 rejected changed-state/partial/recreated-window requests (including the repeated 200-case matrix), with zero unintended button actions; moving the same control remained allowed and was independently verified. The corrected harness binds the known main HWND after observing it in MCP, because WinForms can expose a same-title parking window during recreation.

WinForms and Electron dense discovery, rooted reads/edits, uniqueness and stale identity smoke checks passed. Builds, repository lint/type checks, 296 backend tests (one optional skip), and 10 script tests passed. The full run exposed a pre-existing still-idle startup frame/state mismatch; the constructor now records the actual initial rendered action and the regression check fixes its random initial direction.

The local authenticated Pokémon MCP server was restarted with the verified build. Through that live server, the requested Edge Claude review window was re-observed, its uniquely focusable composer was read in a complete 232-node scan, and fresh identity guards focused it. The final window check confirmed Edge was active. No additional message was sent to Claude. The task outcome was recorded as met; actual user satisfaction remains unknown pending explicit feedback.
