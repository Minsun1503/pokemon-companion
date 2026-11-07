# Desktop tool benchmark

20 measured runs per scenario and UI mode. Failed native typing checks are preserved and counted, not retried or treated as success. Nested spans overlap: worker/tree/post-processing and serialization are included in action; capture_hide/show are included in companion_before/after. Tool total excludes SDK framing; client elapsed includes stdio. Cold start also includes server connection. Fixture setup and independent verification are outside timers.

| Companion | Scenario | Min ms | Median ms | p95 ms | Image bytes | Verified |
|---|---|---:|---:|---:|---:|---:|
| on | cold_start | 1240.5 | 1716.5 | 1936.1 | 0 | 20/20 |
| on | windows_get_ui_narrow | 61.4 | 68.2 | 82.3 | 0 | 20/20 |
| on | windows_get_ui_wide | 67.8 | 71.3 | 83.0 | 0 | 20/20 |
| on | windows_set_verify_atomic | 85.8 | 96.8 | 116.6 | 0 | 20/20 |
| on | windows_set_verify_batch | 86.2 | 92.7 | 109.8 | 0 | 20/20 |
| off | cold_start | 1335.3 | 1390.1 | 1430.5 | 0 | 20/20 |
| off | windows_get_ui_narrow | 50.4 | 54.0 | 92.7 | 0 | 20/20 |
| off | windows_get_ui_wide | 54.9 | 59.1 | 63.9 | 0 | 20/20 |
| off | windows_set_verify_atomic | 65.2 | 76.5 | 106.4 | 0 | 20/20 |
| off | windows_set_verify_batch | 63.7 | 70.3 | 79.7 | 0 | 20/20 |
