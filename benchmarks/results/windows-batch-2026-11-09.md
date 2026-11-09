# Windows atomic versus batch benchmark

Measured at 2026-11-09T07:47:19.484Z. 5 warm runs per mode, with alternating order in each pair. All 12 recorded workflows passed independent field and button checks; no screenshot images were returned.

| Metric | Atomic | Batch |
| --- | ---: | ---: |
| Windows API steps per workflow | 6 | 6 |
| MCP calls per workflow | 6 | 1 |
| Warm median execution | 4182.0 ms | 4197.5 ms |
| Warm p95 execution | 4231.5 ms | 4236.7 ms |
| Median request JSON characters | 809 | 654 |
| Median result text characters | 1133 | 400 |
| Median result JSON characters | 1541 | 501 |
| Median result JSON UTF-8 bytes | 1557 | 506 |
| Screenshot images | 0 | 0 |

MCP calls decreased by 83.3% and result text by 64.7%. Warm median execution changed by -0.4% (positive means faster for batch).

## Method

The same visible disposable Electron window and the real Pokémon overlay are used for both modes. Each workflow discovers that uniquely named window, discovers its Edit control, sets a unique Unicode value, discovers the Verify button, invokes it, and reads the field again. Both modes use identical UI filters and per-step 2,000-character budgets. Batch additionally checks the expected field value inside the server. An independent HTTP fixture check validates the text and exactly one button click after every run, outside the timer.

The timer covers the six API steps, MCP stdio transport, result parsing, and companion updates. It excludes MCP connection, companion launch, fixture launch, and independent HTTP verification. Fresh-worker runs below use separate MCP processes with an already started overlay; they include PowerShell startup/C# compilation and are single observations. The warm session performs one unreported warmup workflow per mode before the 5 alternating pairs. Warm p95 uses nearest rank; medians average the two middle samples when needed. Every sample is in the adjacent JSON file.

| Fresh worker (one observation each) | Execution |
| --- | ---: |
| atomic | 4661.4 ms |
| batch | 4561.9 ms |

This is a local tool benchmark with no AI inference or network model latency. Six calls versus one offers five fewer opportunities for a sequential model round trip, but no end-to-end AI speedup or dollar/token saving is measured. Characters/bytes are measured, not tokenizer counts. Request/result JSON measurements exclude JSON-RPC envelopes, tool schemas, initialization, and Pokémon task announcement calls. Windows API operations still execute individually inside a batch. Results vary with the app, machine load and accessibility tree; this small fixture does not establish performance for arbitrary apps.

## Environment

- Platform: win32 10.0.26200, x64
- CPU: 11th Gen Intel(R) Core(TM) i7-1165G7 @ 2.80GHz; 8 logical processors
- Node: v22.12.0; Electron: 42.3.3
- Overlay: enabled; transport: stdio
- Reproduce: npm run benchmark:windows -- --runs 5 --output benchmarks/results/windows-batch-2026-11-09.json
- Raw data includes SHA-256 hashes of the built backend files used in this run.
