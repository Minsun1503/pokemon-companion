# Desktop tool benchmark

20 measured runs per scenario and UI mode. Failed native typing checks are preserved and counted, not retried or treated as success. Nested spans overlap: worker/tree/post-processing and serialization are included in action; capture_hide/show are included in companion_before/after. Tool total excludes SDK framing; client elapsed includes stdio. Cold start also includes server connection. Fixture setup and independent verification are outside timers.

| Companion | Scenario | Min ms | Median ms | p95 ms | Image bytes | Verified |
|---|---|---:|---:|---:|---:|---:|
| on | cold_start | 1640.5 | 2226.3 | 2500.6 | 0 | 20/20 |
| on | windows_get_ui_narrow | 57.8 | 66.3 | 79.1 | 0 | 20/20 |
| on | windows_get_ui_wide | 68.3 | 71.6 | 85.4 | 0 | 20/20 |
| on | windows_set_verify_atomic | 83.3 | 93.8 | 130.3 | 0 | 20/20 |
| on | windows_set_verify_batch | 82.6 | 105.7 | 129.9 | 0 | 20/20 |
| off | cold_start | 1599.8 | 1668.7 | 1893.8 | 0 | 20/20 |
| off | windows_get_ui_narrow | 54.6 | 56.4 | 69.2 | 0 | 20/20 |
| off | windows_get_ui_wide | 56.8 | 59.1 | 66.0 | 0 | 20/20 |
| off | windows_set_verify_atomic | 68.4 | 76.4 | 97.5 | 0 | 20/20 |
| off | windows_set_verify_batch | 62.1 | 69.0 | 80.6 | 0 | 20/20 |
