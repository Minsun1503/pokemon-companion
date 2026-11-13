# Windows MCP benchmarks

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
