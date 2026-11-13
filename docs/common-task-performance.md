# Common task performance — November 13, 2026

The interrupted workflow benchmark is complete. All 100 measured attempts and 20 excluded warmups passed, with no failed, timed-out or blocked scenarios in the final run. Build, lint, 330 backend tests, 20 script tests, the later eight benchmark regression checks, WinForms/Electron identity smoke tests and the native window-proof renewal check passed. One backend test was skipped. The saved build and harness hashes were verified against the tested files. Automatic GitHub pushing remains paused; the changes are local.

## What the comparison measures

This is a same-build comparison of alternative execution strategies through the actual MCP tools, using an existing signed-in Edge profile and disposable desktop Excel workbooks. Baseline uses atomic calls or whole-page reads; optimized uses batching, scoped discovery, passage lookup or rectangular Excel operations. The window-discovery rows deliberately execute the same strategy to show ordinary timing variation. These columns are not historical Git revisions.

Each of ten cases has five measured runs per strategy. One warmup per case/strategy is excluded and strategy order reverses each round. Timers begin at the first MCP request and end after the requested outcome is verified. Preparation, app startup, AI inference and user-request intake are excluded. Native timings, action/verification durations, MCP calls and returned characters are retained in the JSON. Five-sample p95 is the slowest observed attempt, not a stable population tail estimate.

| Operation | Atomic/full-read median ms | Alternative median ms | MCP calls |
| --- | ---: | ---: | --- |
| Window discovery, reference | 17.9 | 18.6 | 1 → 1 |
| Control discovery, whole window vs scoped | 90.4 | 120.7 | 1 → 1 |
| Enter text and verify | 401.9 | 405.9 | 4 → 2 |
| Search, open result and read facts | 1,562.4 | 1,279.4 | 10 → 4 |
| Invoke button and verify resulting record state | 603.7 | 596.9 | 3 → 2 |
| Retrieve three document passages | 523.2 | 267.3 | 2 → 1 |
| Open URL and verify document | 984.7 | 984.7 | 8 → 5 |
| Open actual PDF and retrieve its facts | 1,068.7 | 1,088.6 | 9 → 6 |
| Read ten Excel cells | 414.0 | 61.6 | 10 → 1 |
| Write ten cells, calculate, save and reopen | 1,151.6 | 702.6 | 12 → 3 |

The clearest gains are Excel range reads (85%), Excel writes/calculation/save (39%), document passage retrieval (49%), and search/open/read (18%). Scoped lookup was slower on this small page. Fewer calls did not consistently improve text entry, button actions, URL opening or PDF reading. The client guidance now recommends bulk Excel operations, avoids unnecessary foreground activation of visible windows, and reserves scoped discovery for ambiguity or larger trees. Existing batched passage retrieval remains the preferred route for several known phrases.

Excel verification overhead remains material: independently reopening and checking the saved workbook takes approximately half a second. The write action itself measured 621 ms for single-cell operations and 192 ms for bulk operations; the complete verified workflow is the appropriate reported result.

## Correctness and fixes

The browser fixture verifies the exact search query, selected record and button event counts independently over loopback. Each page uses a unique token; old events are ignored. Background resource requests, including favicons, previously reset those counters and created false timeouts. They now return 404 without changing scenario state, and the regression test covers this behavior.

Navigation focuses an observed address control before a guarded Return key rather than redundantly activating an already visible window. Discovery refreshes the selected window token during long workflows. Fresh discovery renews the same verified owner/handle token without rebinding it; idle window proofs and element snapshots retain their two-minute expiry. The native regression check covers renewal, idle expiry and mismatched-window rejection. WinForms and Electron smoke tests verify minimized windows, scoped discovery and editing, pinned absence and identity-change rejection.

The PDF case serves a real PDF with a text layer. Edge's Document range was ambiguous, so the existing native guard correctly rejected it. The runner then waited for a complete fresh Text-control observation and retrieved all three seeded facts through MCP. All final PDF samples used this route, recorded as `accessible_text_nodes` with `identity_fallback: true`. The verifier checks the requested loopback PDF URL; it never substitutes the source PDF bytes for a missing UI read. Edge sometimes omits `http://` in the address display. URL comparison now normalizes that specific loopback format while preserving origin, port and path checks, with regression coverage for other origins.

Excel uses the production native-object-model APIs on a specifically inspected workbook. The independent fixture checks exact values, the calculated sum of 55, the formula and saved path after reopening, and that a second workbook remains untouched. No user workbook is a target.

Failed diagnostic runs remain available, including the [URL verification failure](../benchmarks/results/common-tasks-url-verification-error-2026-11-13.md) and [corrected PDF pilot](../benchmarks/results/common-tasks-pdf-verified-2026-11-13.md). The final run has no cleanup notes; its owned tab and Excel fixtures were closed normally.

## Use and limits

Run `npm run benchmark:common -- --window-id ID --runs 5 --output benchmarks/results/common-tasks.json` after building. Choose ID from `windows get_windows` for an existing English Edge window. Use `--cases` for a subset, `--modes` for a strategy, and `--runs 20` for a larger comparison. Keep builds and other tests separate from timed runs. `npm run test:common-benchmark` runs the eight reporting/fixture regression checks and is included in `npm test`.

This measures controlled shared operations, not the complete latency of a user's natural-language request. It does not validate authenticated Zalo, Teams, Outlook, SharePoint, Drive, Dicreto or GS1 integrations. The PDF case is a one-page text PDF, not a scanned document or arbitrary PDF viewer. Signed-in cloud workflows, internet loading, app startup and actual AI-client measurements remain separate scenarios described in the [workflow plan](../benchmarks/workflow-suite-plan.md).

See the [final benchmark report](../benchmarks/results/common-tasks-final-2026-11-13.md) and [raw samples](../benchmarks/results/common-tasks-final-2026-11-13.json).
