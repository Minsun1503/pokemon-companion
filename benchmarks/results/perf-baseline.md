# Desktop tool benchmark

20 measured runs per scenario and UI mode. Failed native typing checks are preserved and counted, not retried or treated as success. Nested spans overlap: worker/tree/post-processing and serialization are included in action; capture_hide/show are included in companion_before/after. Tool total excludes SDK framing; client elapsed includes stdio. Cold start also includes server connection. Fixture setup and independent verification are outside timers.

| Companion | Scenario | Min ms | Median ms | p95 ms | Image bytes | Verified |
|---|---|---:|---:|---:|---:|---:|
| on | cold_start | 1746.6 | 1828.9 | 2069.1 | 0 | 20/20 |
| on | windows_get_windows | 45.7 | 56.7 | 79.0 | 0 | 20/20 |
| on | windows_get_ui_narrow | 59.6 | 64.5 | 79.4 | 0 | 20/20 |
| on | windows_get_ui_wide | 72.1 | 77.3 | 99.2 | 0 | 20/20 |
| on | windows_set_verify_atomic | 85.2 | 92.4 | 106.3 | 0 | 20/20 |
| on | windows_set_verify_batch | 82.3 | 86.3 | 110.4 | 0 | 20/20 |
| on | computer_type_5 | 84.0 | 93.9 | 103.6 | 0 | 20/20 |
| on | computer_type_50 | 780.8 | 793.6 | 804.1 | 0 | 20/20 |
| on | computer_type_500 | 7802.7 | 7812.3 | 7829.2 | 0 | 20/20 |
| on | computer_key | 36.3 | 48.0 | 52.7 | 0 | 20/20 |
| on | computer_left_click | 121.5 | 135.7 | 145.7 | 0 | 20/20 |
| on | computer_get_screenshot | 675.7 | 741.8 | 889.4 | 183339 | 20/20 |
| on | pokemon_say | 3.2 | 5.1 | 8.3 | 0 | 20/20 |
| off | cold_start | 1341.4 | 1605.1 | 1813.8 | 0 | 20/20 |
| off | windows_get_windows | 30.6 | 34.3 | 42.5 | 0 | 20/20 |
| off | windows_get_ui_narrow | 48.0 | 52.1 | 61.1 | 0 | 20/20 |
| off | windows_get_ui_wide | 60.9 | 68.4 | 75.3 | 0 | 20/20 |
| off | windows_set_verify_atomic | 62.5 | 68.4 | 90.9 | 0 | 20/20 |
| off | windows_set_verify_batch | 61.3 | 66.1 | 74.6 | 0 | 20/20 |
| off | computer_type_5 | 74.5 | 79.1 | 87.9 | 0 | 20/20 |
| off | computer_type_50 | 775.1 | 781.6 | 784.9 | 0 | 20/20 |
| off | computer_type_500 | 7779.5 | 7790.0 | 7797.0 | 0 | 20/20 |
| off | computer_key | 28.4 | 31.2 | 39.5 | 0 | 20/20 |
| off | computer_left_click | 102.7 | 105.8 | 118.4 | 0 | 20/20 |
| off | computer_get_screenshot | 513.5 | 613.6 | 824.9 | 180087.5 | 20/20 |
| off | pokemon_say | 0.4 | 0.6 | 1.3 | 0 | 20/20 |
