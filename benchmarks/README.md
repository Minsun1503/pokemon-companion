# Windows MCP benchmarks

## Local workflow ranker

After building, run `npm run benchmark:ranker -- --baseline PATH --output benchmarks/results/local-ranker.json`. PATH must contain the saved pre-change `backend/dist` with resolvable dependencies. This compares actual learning services against the same synthetic encrypted snapshot: 32 workflows, eight contexts each, 198 correctness cases, counterbalanced positive/rejected/mixed timing blocks, feedback correction and restart checks. It also verifies unchanged legacy snapshots and exact positive suggestion scores/order. Profiles and test ratings are disposable; no user learning data or native inputs are used.

The [November 13 final report](results/local-ranker-final-2026-11-13.md) and [implementation details](../docs/local-ranker-improvements.md) explain the action hints, bounded negative contexts and competing-workflow fix. These are synthetic regression results and local service timings; general semantic interpretation and AI-client latency are not established.

## Common operations behind app workflows

```powershell
npm run build
npm run benchmark:common -- --window-id 12345 --runs 5 --output benchmarks/results/common-tasks.json
```

Choose an existing English Edge window using the ID from `windows get_windows`. The runner opens an owned test tab in that signed-in profile and serves controlled data on loopback. It also creates its own desktop Excel instance with two disposable workbooks; it verifies that the second workbook remains untouched. Excel edits are checked independently after reopening the saved workbook. Existing user workbooks are not benchmark targets.

Ten cases cover window/control discovery, verified text entry, search and result opening, a button's resulting state, passage retrieval, URL navigation, actual PDF opening/reading, Excel range reads, and Excel writes/calculation/save. Each compares atomic calls or whole-page reads with batching, scoped lookup, passage lookup or rectangular Excel operations in the **same build**. Window discovery is a repeated reference measurement, not a different implementation.

One warmup per case/strategy is excluded. Measured strategy order reverses each round. Default five runs gives an initial diagnostic comparison; use `--runs 20` for a larger sample. `--cases` and `--modes` accept comma-separated selections. Each timer begins at the first MCP request and ends after verification; setup, application startup, model inference and user-request intake are excluded. JSON includes action/verification times, MCP call counts, native timing spans, failures, build and harness hashes. The adjacent Markdown report shows median and observed p95; a five-sample p95 is the slowest recorded sample.

An action is not automatically replayed after failure. Remaining rows for that case are recorded as blocked. Exit code 0 means all selected cases passed, 2 means an unsupported/blocked case, and 1 means failure. `complete` means all scheduled rows were recorded; check `all_passed` and each case's counts before claiming success. PDF text must be retrieved through the production native API, not read from the fixture response by the verifier. A viewer with inaccessible or ambiguous PDF controls is reported as blocked.

The fixture rejects background resource paths so favicon requests cannot reset action evidence, and ignores events from old page tokens. Fresh discovery renews the same verified window token while it is in use; idle window proofs and all element snapshots retain their two-minute expiration. Control focus precedes guarded keyboard navigation, without redundant foreground activation of an already visible browser.

This suite tests shared operations, not authenticated integrations with Zalo, Teams, Outlook, SharePoint, Drive, Dicreto or GS1. See the [workflow plan](workflow-suite-plan.md) for the separate live and actual AI-client measurements. Run `npm run test:common-benchmark` for fixture and reporting regression checks; these also run under `npm test`. Keep builds and tests separate from timed desktop runs.

The [November 13 final run](results/common-tasks-final-2026-11-13.md) passed all 100 measured attempts, including actual PDF text retrieval and Excel save/reopen checks. [Findings and implementation](../docs/common-task-performance.md) explain the measured gains, slower scoped lookup, the PDF Text-control fallback, and preserved diagnostic failures.

## Edge web search and information retrieval

```powershell
npm run build
npm run benchmark:retrieval -- --window-id 12345 --runs 5 --modes page_scan,range_single,range_many --verify --output benchmarks/results/information-retrieval.json
```

Replace `12345` with the existing Edge window ID returned by `windows get_windows`. The benchmark reuses that window's profile and opens an additional tab. It requires one unambiguous Edge window unless `--window-id` is supplied. It creates no temporary browser profile and uses no CDP. The controlled tab is closed only after its unique document title and localhost address are verified; existing tabs remain available.

The harness serves a loopback research corpus, uses actual MCP/native UIA to enter a query and click its result, then returns three source facts from the page. `page_scan` uses existing versioned pagination, `range_single` performs three separate phrase lookups, and `range_many` uses one batched lookup. The nominal 12k/48k articles have facts near the end. Server state independently verifies query/click counts; complete facts must appear in retrieved text. `--verify` adds native correctness checks outside measurement, covering missing and case-sensitive matches, duplicate query order, zero context, Unicode, response budgets, stale references, and non-Document rejection.

`--runs` accepts 1–50 (default 5); `--modes` selects the compared strategies. Mode order rotates/reverses. Startup and tab preparation are excluded, while retrieval and the entire search/click/read workflow are measured separately. JSON checkpoints retain unsuccessful runs; completed reports include medians/p95, individual timings, response sizes, source links, and build/harness/corpus hashes. Controlled timings exclude internet search and AI inference.

Append `--live` to also search Bing for a public Microsoft document, click its result, verify the source address and retrieve a quoted passage. The live tab remains open for inspection. External loading, search results and site challenges can fail the run; the harness preserves the failure and does not retry input or navigate directly to manufacture success. English Edge/site controls are required. This desktop benchmark is separate from CI.

Recorded reports: [final comparison and correctness checks](results/information-retrieval-final-2026-11-13.md), [initial range comparison](results/information-retrieval-range-2026-11-13.md), and [final live Bing verification](results/information-retrieval-live-final-2026-11-13.md). See [research, implementation and limits](../docs/information-retrieval.md).

## Edge → YouTube → search → watch

```powershell
npm run build
npm run benchmark:youtube -- --runs 3 --query "Big Buck Bunny Blender" --output benchmarks/results/edge-youtube-2026-11-13.json
```

This live Windows benchmark opens a separate Edge process and fresh temporary profile for each run, opens YouTube, fills the site's search field, invokes Search, clicks a visible video result through UI Automation, and verifies playback. The repository's MCP tools perform navigation and website actions. The harness spawns Edge with isolation/accessibility settings; Edge startup is timed, while MCP/companion startup is reported separately. Audio is muted.

Read-only Chrome DevTools Protocol observations inspect only the dedicated benchmark tab. They verify the exact search query, the clicked watch URL and player video ID, absence of an active ad, and at least one second of unpaused video progress. A watch URL or a playing advertisement alone cannot pass. CDP does not navigate, type, click or start playback; it closes the dedicated browser during cleanup.

JSON records every stage, MCP call duration, native timing logs, selected video and playback evidence. The adjacent Markdown report shows total and stage medians/p95. Total time starts before Edge launches and ends when playback is verified; it includes network/loading/rendering waits and verification overhead. Failed runs retain their observations and return a nonzero exit code, without replaying input. A failure can save a screenshot of the dedicated tab for diagnosis. Success statistics include only verified runs; incomplete reports show how many requested runs were attempted.

`--runs` accepts 1–20 (default 3), `--query` accepts up to 150 characters, and `--timeout` sets each website wait budget in milliseconds (default 90000, range 10000–180000). Live YouTube access, consent/sign-in challenges, ads, autoplay policy and UI language can stop a run. The script expects English Edge/YouTube controls and never accepts consent or signs in automatically. Profiles and benchmark processes are removed afterward; existing browser profiles/tabs are not used. OS/network caches are not reset. This measures local execution plus a live website, without AI inference; a three-run p95 is simply the slowest observed sample.

Run `npm run test:youtube-benchmark` for playback-verification checks. The live benchmark is intentionally separate from CI because it needs an unlocked desktop and external YouTube access.

For the full desktop latency baseline, run `node scripts/bench.mjs benchmarks/results/perf-baseline.json` after building. It runs 20 verified samples for each scenario with the companion on and off: cold startup, window discovery, narrow/wide UI reads, atomic/batched field updates, typing 5/50/500 characters, a key chord, clicking, screenshots, and Pokémon speech. Setup, focus settling and independent fixture checks are outside the timers. JSON checkpoints have `complete: false` until every scenario finishes; completed runs also produce a Markdown table and built-file hashes.

For a focused comparison, append scenario names after the output path, for example `node scripts/bench.mjs benchmarks/results/perf-a.json windows_get_windows windows_get_ui_narrow pokemon_say`. Each selected scenario still runs 20 times per UI mode. Typing uses digits and spaces to avoid composition under the active Vietnamese input method. Report writes use staging files and bounded retries for transient Windows sharing errors; desktop inputs are never retried.

`POKEMON_TIMING=1` enables one `[pokemon-timing]` JSON line per tool call on stderr. It reports queue wait, companion before/after, action, payload serialization, Windows worker round-trip, UIA tree walk, and response post-processing. Screenshot calls additionally report capture, resize, PNG encoding, base64, and overlay hide/show. Timing is off by default and never adds fields to MCP responses. These are nested spans: worker/tree/serialization are inside action, and hide/show are inside companion before/after. Client elapsed includes SDK framing and stdio; server total covers the tool handler.

Build the project, then run the atomic versus batch benchmark in a Windows desktop session:

```powershell
npm run build
npm run benchmark:windows -- --runs 20 --output benchmarks/results/windows-batch-2026-11-07.json
```

The script launches a uniquely named disposable test window and a real Pokémon overlay, using isolated application data. It compares the same six Windows API steps through six atomic MCP calls versus one batch call: find the window, find the field, fill it, find the button, invoke it, and read the field. It independently checks the field and button count after every workflow and fails if any operation is incorrect or returns a screenshot image.

Fresh-worker observations use separate MCP processes. Warm measurements use a single persistent worker, one warmup per mode, and alternating order across paired runs. The default is 20 runs per mode; `--runs` accepts 5–100. JSON contains every recorded sample, startup measurements, median/p95/min/max/mean execution times, request/result character and UTF-8 byte counts, and hashes of the built backend files. A Markdown report is generated alongside it. Output paths are relative to the project root unless absolute.

The timer includes Windows APIs, MCP stdio transport, parsing, and companion updates. Connection, overlay launch, and independent HTTP verification are measured separately or excluded. This benchmark uses no AI inference, so it measures neither end-to-end model latency nor actual tokens/dollars. Fewer MCP calls and smaller responses support lower orchestration overhead, but results for this small accessibility tree do not predict every application.

Recorded run: [November 7, 2026 report](results/windows-batch-2026-11-07.md) and [raw samples](results/windows-batch-2026-11-07.json).
