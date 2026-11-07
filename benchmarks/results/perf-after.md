# Desktop tool benchmark

20 measured runs per scenario and UI mode. Failed native typing checks are preserved and counted, not retried or treated as success. Nested spans overlap: worker/tree/post-processing and serialization are included in action; capture_hide/show are included in companion_before/after. Tool total excludes SDK framing; client elapsed includes stdio. Cold start also includes server connection. Fixture setup and independent verification are outside timers.

| Companion | Scenario | Min ms | Median ms | p95 ms | Image bytes | Verified |
|---|---|---:|---:|---:|---:|---:|
| on | cold_start | 1234.3 | 1579.7 | 2413.0 | 0 | 20/20 |
| on | windows_get_windows | 46.9 | 50.6 | 72.4 | 0 | 20/20 |
| on | windows_get_ui_narrow | 31.5 | 34.8 | 39.7 | 0 | 20/20 |
| on | windows_get_ui_wide | 34.6 | 45.0 | 57.1 | 0 | 20/20 |
| on | windows_set_verify_atomic | 58.3 | 63.7 | 74.9 | 0 | 20/20 |
| on | windows_set_verify_batch | 54.8 | 59.4 | 82.0 | 0 | 20/20 |
| on | computer_type_5 | 5.4 | 7.7 | 14.2 | 0 | 20/20 |
| on | computer_type_50 | 21.2 | 28.5 | 33.7 | 0 | 20/20 |
| on | computer_type_500 | 187.9 | 194.4 | 209.4 | 0 | 20/20 |
| on | computer_key | 32.7 | 41.5 | 46.5 | 0 | 20/20 |
| on | computer_left_click | 118.8 | 130.5 | 139.3 | 0 | 20/20 |
| on | computer_get_screenshot | 528.8 | 555.9 | 651.5 | 144053 | 20/20 |
| on | pokemon_say | 4.0 | 5.4 | 9.6 | 0 | 20/20 |
| off | cold_start | 1352.1 | 1418.0 | 1680.6 | 0 | 20/20 |
| off | windows_get_windows | 32.1 | 35.5 | 41.4 | 0 | 20/20 |
| off | windows_get_ui_narrow | 24.4 | 26.0 | 27.3 | 0 | 20/20 |
| off | windows_get_ui_wide | 23.5 | 27.2 | 31.2 | 0 | 20/20 |
| off | windows_set_verify_atomic | 40.9 | 45.4 | 55.4 | 0 | 20/20 |
| off | windows_set_verify_batch | 37.1 | 42.2 | 49.8 | 0 | 20/20 |
| off | computer_type_5 | 2.0 | 2.5 | 3.6 | 0 | 20/20 |
| off | computer_type_50 | 12.2 | 14.7 | 17.0 | 0 | 20/20 |
| off | computer_type_500 | 146.1 | 167.1 | 196.3 | 0 | 20/20 |
| off | computer_key | 26.7 | 36.8 | 42.4 | 0 | 20/20 |
| off | computer_left_click | 103.0 | 108.1 | 118.1 | 0 | 20/20 |
| off | computer_get_screenshot | 373.4 | 418.5 | 461.4 | 145294 | 20/20 |
| off | pokemon_say | 0.4 | 0.7 | 1.2 | 0 | 20/20 |
