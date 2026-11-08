# Desktop tool benchmark

20 measured runs per scenario and UI mode. Failed native typing checks are preserved and counted, not retried or treated as success. Nested spans overlap: worker/tree/post-processing and serialization are included in action; capture_hide/show are included in companion_before/after. Tool total excludes SDK framing; client elapsed includes stdio. Cold start also includes server connection. Fixture setup and independent verification are outside timers.

| Companion | Scenario | Min ms | Median ms | p95 ms | Image bytes | Verified |
|---|---|---:|---:|---:|---:|---:|
| on | windows_get_ui_narrow | 24.4 | 26.6 | 39.0 | 0 | 20/20 |
| on | windows_get_ui_wide | 23.9 | 25.3 | 27.4 | 0 | 20/20 |
| on | windows_set_verify_atomic | 37.4 | 45.3 | 54.5 | 0 | 20/20 |
| on | windows_set_verify_batch | 38.3 | 41.8 | 49.6 | 0 | 20/20 |
| off | windows_get_ui_narrow | 19.0 | 19.7 | 31.3 | 0 | 20/20 |
| off | windows_get_ui_wide | 19.0 | 19.3 | 20.9 | 0 | 20/20 |
| off | windows_set_verify_atomic | 27.0 | 31.4 | 52.8 | 0 | 20/20 |
| off | windows_set_verify_batch | 27.4 | 28.9 | 38.5 | 0 | 20/20 |
