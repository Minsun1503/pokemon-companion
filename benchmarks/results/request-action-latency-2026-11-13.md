# Request-to-action latency iterations

The request path is MCP parsing, the serialized desktop queue, the native control lease, the companion interaction lock, then the Windows action. The measurements below cover local tool execution; external model inference and the time spent entering a request are outside this repository's benchmark.

## Iteration 1: defer identity proofs until after window filtering

Window discovery previously captured or revalidated identity proofs for every visible window before applying its title/process filter. It now performs that work only for returned windows. Returned windows retain fresh identity verification, stable references, and minimized-window reporting. Process objects are disposed after metadata lookup.

The saved baseline and a fresh verification run each contain 20 samples per scenario with the companion enabled and disabled:

| Companion | Scenario | Baseline median | Iteration 1 median |
| --- | --- | ---: | ---: |
| on | Window discovery | 91.6 ms | 59.9 ms |
| off | Window discovery | 68.2 ms | 45.8 ms |
| on | Narrow UI discovery | 48.8 ms | 45.4 ms |
| on | Atomic field update + verification | 112.6 ms | 119.6 ms |
| on | Batched field update + verification | 121.6 ms | 116.8 ms |

Window discovery improved by approximately 35% with the companion enabled and 33% disabled. Field-update measurements vary and do not establish an improvement from this discovery-only change. These are sequential runs on one desktop, not a counterbalanced comparison; desktop load can affect the result.

All 160 measured verification samples passed. Build, lint/type checks, 311 backend tests (one skipped), 10 chat/animation tests, and native WinForms/Electron identity, window coverage, and cross-process coordination checks passed. Identity checks additionally exercise process filtering, empty matches, and stable references after filtered rediscovery.

- [Baseline samples](request-latency-baseline-2026-11-13.json)
- [Initial iteration samples](request-latency-iteration-1-2026-11-13.json)
- [Fresh verification samples](request-latency-iteration-1-verified-2026-11-13.json)

Reproduce after `npm run build`:

```powershell
node scripts/bench.mjs benchmarks/results/request-latency-iteration-1-verified-2026-11-13.json windows_get_windows windows_get_ui_narrow windows_set_verify_atomic windows_set_verify_batch
```
