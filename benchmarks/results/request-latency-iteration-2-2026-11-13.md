# Desktop tool benchmark

20 measured runs per scenario and UI mode. Failed native typing checks are preserved and counted, not retried or treated as success. Nested spans overlap: worker/tree/post-processing and serialization are included in action; capture_hide/show are included in companion_before/after. Tool total excludes SDK framing; client elapsed includes stdio. Cold start also includes server connection. Fixture setup and independent verification are outside timers.

| Companion | Scenario | Min ms | Median ms | p95 ms | Image bytes | Verified |
|---|---|---:|---:|---:|---:|---:|
| on | windows_get_windows | 12.0 | 16.6 | 25.4 | 0 | 20/20 |
| on | windows_get_ui_narrow | 41.1 | 49.4 | 69.0 | 0 | 20/20 |
| on | windows_set_verify_atomic | 116.4 | 126.6 | 137.0 | 0 | 20/20 |
| on | windows_set_verify_batch | 115.8 | 123.1 | 138.7 | 0 | 20/20 |
| off | windows_get_windows | 5.9 | 8.7 | 10.7 | 0 | 20/20 |
| off | windows_get_ui_narrow | 36.0 | 38.6 | 56.7 | 0 | 20/20 |
| off | windows_set_verify_atomic | 96.6 | 104.6 | 112.8 | 0 | 20/20 |
| off | windows_set_verify_batch | 93.0 | 97.5 | 101.7 | 0 | 20/20 |
