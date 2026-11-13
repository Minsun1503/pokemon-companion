# Desktop tool benchmark

20 measured runs per scenario and UI mode. Failed native typing checks are preserved and counted, not retried or treated as success. Nested spans overlap: worker/tree/post-processing and serialization are included in action; capture_hide/show are included in companion_before/after. Tool total excludes SDK framing; client elapsed includes stdio. Cold start also includes server connection. Fixture setup and independent verification are outside timers.

| Companion | Scenario | Min ms | Median ms | p95 ms | Image bytes | Verified |
|---|---|---:|---:|---:|---:|---:|
| on | windows_get_windows | 51.8 | 54.3 | 72.4 | 0 | 20/20 |
| on | windows_get_ui_narrow | 42.5 | 45.0 | 56.5 | 0 | 20/20 |
| on | windows_set_verify_atomic | 99.7 | 115.1 | 128.9 | 0 | 20/20 |
| on | windows_set_verify_batch | 107.4 | 114.5 | 118.5 | 0 | 20/20 |
| off | windows_get_windows | 36.9 | 40.8 | 46.0 | 0 | 20/20 |
| off | windows_get_ui_narrow | 33.0 | 33.7 | 46.3 | 0 | 20/20 |
| off | windows_set_verify_atomic | 90.1 | 96.7 | 116.7 | 0 | 20/20 |
| off | windows_set_verify_batch | 88.2 | 94.2 | 97.9 | 0 | 20/20 |
