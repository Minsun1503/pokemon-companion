# Native worker response encoding — November 12, 2026

The worker now reuses .NET's installed `JavaScriptSerializer` for successful and failed responses instead of invoking PowerShell's `ConvertTo-Json` pipeline for every call. Request parsing, Excel request encoding, targeting guards, and public response budgets are unchanged. No dependency was added.

## Measurements

Raw samples: [first run](windows-encoding-2026-11-12.json) and [confirmation](windows-encoding-confirmation-2026-11-12.json). Each run uses two warmed workers, one owned WinForms fixture, and fifteen ABBA blocks: 30 samples per implementation/scenario. Assertions follow the timed request. The fixed-seed bootstrap resamples whole paired blocks.

First run:

| Request | Before median | After median | Paired median saving | 95% bootstrap interval |
| --- | ---: | ---: | ---: | ---: |
| Worker status | 0.538 ms | 0.442 ms | 0.108 ms | 0.096 to 0.124 ms |
| One editable field | 477.818 ms | 406.755 ms | 60.178 ms | −9.101 to 111.477 ms |
| Thirty editable fields | 522.692 ms | 505.513 ms | 5.780 ms | −39.933 to 29.786 ms |

The status median fell 17.74%, saving roughly one tenth of a millisecond. The UI-read intervals include zero, and the dense-read p95 increased from 684.123 to 767.900 ms. This establishes a small encoding/transport improvement on the fast status path; it does not establish a general UI speedup.

The confirmation status median fell from 0.629 to 0.472 ms (25.01%); paired saving was 0.133 ms, with a 95% interval of 0.106 to 0.138 ms. Narrow/dense medians were slower in this repeat; their paired intervals again included zero (−19.988 to 31.841 ms and −46.844 to 22.116 ms). The replicated gain is confined to fast worker response handling.

The confirmation harness also asserts identical hashes for the adapter and every native source. DLL hashes may differ after recompilation; both DLL hashes are recorded for provenance.

## Verification and reproduction

Each benchmark run checks 180 requests, 1,800 independently known dense field values, Unicode writes/readback (Vietnamese, Japanese, emoji, quotes, backslashes and control characters), and structured rejection dispositions. The prior chat's build, lint, unit, native contract, identity and coordination checks passed. Additional learning checks passed, including native replay, failure stopping without extra input, encrypted storage, feedback UI, HTTP authentication and packaged contracts.

Excel smoke could not start because Microsoft Excel is not registered on this machine (`CO_E_CLASSSTRING`). Its response shapes remain covered by unit tests, but live Excel compatibility was not verified.

Preserve the built baseline outside the checkout, with `backend/dist` and a `backend/node_modules` junction. Build the changed backend, then run:

```powershell
node scripts/windows-encoding-benchmark.mjs <baseline-project-root> <output-json>
```

Timing includes the adapter/native transport and excludes MCP framing, overlay animation and model inference. One Windows fixture cannot establish performance for all applications. An existing MCP worker must reconnect to load the rebuilt implementation.
