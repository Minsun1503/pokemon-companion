# Desktop tool benchmark

20 measured runs per scenario and UI mode. Failed native typing checks are preserved and counted, not retried or treated as success. Nested spans overlap: worker/tree/post-processing and serialization are included in action; capture_hide/show are included in companion_before/after. Tool total excludes SDK framing; client elapsed includes stdio. Cold start also includes server connection. Fixture setup and independent verification are outside timers.

| Companion | Scenario | Min ms | Median ms | p95 ms | Image bytes | Verified |
|---|---|---:|---:|---:|---:|---:|
| on | windows_get_windows | 76.1 | 91.6 | 111.0 | 0 | 20/20 |
| on | windows_get_ui_narrow | 40.1 | 48.8 | 57.6 | 0 | 20/20 |
| on | windows_set_verify_atomic | 101.8 | 112.6 | 128.5 | 0 | 20/20 |
| on | windows_set_verify_batch | 104.3 | 121.6 | 128.8 | 0 | 20/20 |
| off | windows_get_windows | 57.8 | 68.2 | 72.4 | 0 | 20/20 |
| off | windows_get_ui_narrow | 35.5 | 37.8 | 50.2 | 0 | 20/20 |
| off | windows_set_verify_atomic | 86.6 | 94.2 | 111.3 | 0 | 20/20 |
| off | windows_set_verify_batch | 87.0 | 95.7 | 102.6 | 0 | 20/20 |
