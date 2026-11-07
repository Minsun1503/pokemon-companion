# Desktop tool benchmark

20 measured runs per scenario and UI mode. Failed native typing checks are preserved and counted, not retried or treated as success. Nested spans overlap: worker/tree/post-processing and serialization are included in action; capture_hide/show are included in companion_before/after. Tool total excludes SDK framing; client elapsed includes stdio. Cold start also includes server connection. Fixture setup and independent verification are outside timers.

| Companion | Scenario | Min ms | Median ms | p95 ms | Image bytes | Verified |
|---|---|---:|---:|---:|---:|---:|
| on | windows_get_windows | 39.5 | 45.7 | 61.1 | 0 | 20/20 |
| on | windows_get_ui_narrow | 44.6 | 45.7 | 47.9 | 0 | 20/20 |
| on | computer_key | 36.4 | 41.9 | 45.5 | 0 | 20/20 |
| off | windows_get_windows | 27.6 | 29.5 | 35.9 | 0 | 20/20 |
| off | windows_get_ui_narrow | 39.3 | 41.5 | 43.1 | 0 | 20/20 |
| off | computer_key | 27.4 | 31.5 | 34.5 | 0 | 20/20 |
