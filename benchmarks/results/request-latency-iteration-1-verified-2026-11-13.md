# Desktop tool benchmark

20 measured runs per scenario and UI mode. Failed native typing checks are preserved and counted, not retried or treated as success. Nested spans overlap: worker/tree/post-processing and serialization are included in action; capture_hide/show are included in companion_before/after. Tool total excludes SDK framing; client elapsed includes stdio. Cold start also includes server connection. Fixture setup and independent verification are outside timers.

| Companion | Scenario | Min ms | Median ms | p95 ms | Image bytes | Verified |
|---|---|---:|---:|---:|---:|---:|
| on | windows_get_windows | 53.4 | 59.9 | 79.9 | 0 | 20/20 |
| on | windows_get_ui_narrow | 41.8 | 45.4 | 49.0 | 0 | 20/20 |
| on | windows_set_verify_atomic | 111.1 | 119.6 | 136.9 | 0 | 20/20 |
| on | windows_set_verify_batch | 110.9 | 116.8 | 122.7 | 0 | 20/20 |
| off | windows_get_windows | 39.4 | 45.8 | 52.9 | 0 | 20/20 |
| off | windows_get_ui_narrow | 34.8 | 38.1 | 51.3 | 0 | 20/20 |
| off | windows_set_verify_atomic | 89.6 | 92.6 | 97.5 | 0 | 20/20 |
| off | windows_set_verify_batch | 86.7 | 93.0 | 101.3 | 0 | 20/20 |
