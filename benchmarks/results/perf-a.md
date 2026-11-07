# Desktop tool benchmark

20 measured runs per scenario and UI mode. Failed native typing checks are preserved and counted, not retried or treated as success. Nested spans overlap: worker/tree/post-processing and serialization are included in action; capture_hide/show are included in companion_before/after. Tool total excludes SDK framing; client elapsed includes stdio. Cold start also includes server connection. Fixture setup and independent verification are outside timers.

| Companion | Scenario | Min ms | Median ms | p95 ms | Image bytes | Verified |
|---|---|---:|---:|---:|---:|---:|
| on | windows_get_windows | 45.5 | 50.7 | 64.6 | 0 | 20/20 |
| on | windows_get_ui_narrow | 68.2 | 81.0 | 103.9 | 0 | 20/20 |
| on | windows_get_ui_wide | 84.8 | 95.2 | 114.0 | 0 | 20/20 |
| on | windows_set_verify_atomic | 91.9 | 102.0 | 128.2 | 0 | 20/20 |
| on | windows_set_verify_batch | 86.7 | 94.9 | 120.6 | 0 | 20/20 |
| on | computer_key | 33.7 | 44.8 | 47.9 | 0 | 20/20 |
| on | pokemon_say | 7.7 | 9.7 | 13.4 | 0 | 20/20 |
| off | windows_get_windows | 38.7 | 41.8 | 50.4 | 0 | 20/20 |
| off | windows_get_ui_narrow | 62.2 | 80.2 | 97.7 | 0 | 20/20 |
| off | windows_get_ui_wide | 88.7 | 110.8 | 126.7 | 0 | 20/20 |
| off | windows_set_verify_atomic | 92.6 | 111.1 | 140.3 | 0 | 20/20 |
| off | windows_set_verify_batch | 64.2 | 80.3 | 108.5 | 0 | 20/20 |
| off | computer_key | 27.0 | 32.6 | 39.8 | 0 | 20/20 |
| off | pokemon_say | 0.3 | 0.4 | 1.1 | 0 | 20/20 |
