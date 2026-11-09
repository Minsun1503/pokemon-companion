# Windows atomic versus batch benchmark

Measured at 2026-11-09T09:25:03.160Z, source revision `2bcfcc3e61bcf9f170044e296e09679dcfc948fb`. Fixture: **plain**. 30 warm runs per mode, with alternating order in each pair. All 62 recorded workflows passed independent field and button checks; no screenshot images were returned.

| Metric | Atomic | Batch |
| --- | ---: | ---: |
| Windows API steps per workflow | 6 | 6 |
| MCP calls per workflow | 6 | 1 |
| Warm median execution | 150.2 ms | 148.0 ms |
| Warm p95 execution | 178.3 ms | 166.8 ms |
| Median request JSON characters | 812 | 654 |
| Median result text characters | 1136 | 401 |
| Median result JSON characters | 1544 | 502 |
| Median result JSON UTF-8 bytes | 1560 | 507 |
| Screenshot images | 0 | 0 |

MCP calls decreased by 83.3% and result text by 64.7%. Warm median execution changed by 1.5% (positive means faster for batch).

## Method

The same visible disposable Electron window and the real Pokémon overlay are used for both modes. Each workflow discovers that uniquely named window, discovers its Edit control, sets a unique Unicode value, discovers the Verify button, invokes it, and reads the field again. Both modes use identical UI filters and per-step 2,000-character budgets. Batch additionally checks the expected field value inside the server. An independent HTTP fixture check validates the text and exactly one button click after every run, outside the timer.

The timer covers the six API steps, MCP stdio transport, result parsing, and companion updates. It excludes MCP connection, companion launch, fixture launch, and independent HTTP verification. First-in-session runs below use separate MCP processes and an already started overlay; they are single observations, not cold-start latency measurements. The server eagerly starts its native worker before the workflow, and loads the compiled DLL when present. Connection/overlay startup times are recorded separately. The warm session performs one unreported warmup workflow per mode before the 30 alternating pairs. Warm p95 uses nearest rank; medians average the two middle samples when needed. Every recorded sample is in the adjacent JSON file; the two verified warmups are excluded from the summaries.

| First workflow in a separate session (one observation each) | Execution |
| --- | ---: |
| atomic | 760.3 ms |
| batch | 377.0 ms |

This is a local tool benchmark with no AI inference or network model latency. Six calls versus one offers five fewer opportunities for a sequential model round trip, but no end-to-end AI speedup or dollar/token saving is measured. Characters/bytes are measured, not tokenizer counts. Request/result JSON measurements exclude JSON-RPC envelopes, tool schemas, initialization, and Pokémon task announcement calls. Windows API operations still execute individually inside a batch. Results vary with the app, machine load and accessibility tree; this small fixture does not establish performance for arbitrary apps.

## Environment

- Platform: win32 10.0.26200, x64
- CPU: Intel(R) Core(TM) Ultra 5 225H; 14 logical processors
- Node: v24.22.1; Electron: 42.3.3
- Overlay: enabled; transport: stdio
- Worker execution policy environment: RemoteSigned (inherited for these test processes only)
- Reproduce after building the backend/frontend: npm run benchmark:windows -- --runs 30 --fixture plain --output benchmarks/results/windows-main-2026-11-09-plain.json
- Raw data includes SHA-256 hashes of the built backend files used in this run.
