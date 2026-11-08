# Desktop tool benchmark

20 measured runs per scenario and UI mode. Failed native typing checks are preserved and counted, not retried or treated as success. Nested spans overlap: worker/tree/post-processing and serialization are included in action; capture_hide/show are included in companion_before/after. Tool total excludes SDK framing; client elapsed includes stdio. Cold start also includes server connection. Fixture setup and independent verification are outside timers.

| Companion | Scenario | Min ms | Median ms | p95 ms | Image bytes | Verified |
|---|---|---:|---:|---:|---:|---:|
| on | computer_type_5 | 4.7 | 5.4 | 8.8 | 0 | 20/20 |
| on | computer_type_50 | 17.8 | 19.4 | 21.8 | 0 | 20/20 |
| on | computer_type_500 | 139.2 | 142.7 | 159.4 | 0 | 20/20 |
| off | computer_type_5 | 1.9 | 2.1 | 2.8 | 0 | 20/20 |
| off | computer_type_50 | 12.3 | 13.1 | 15.6 | 0 | 20/20 |
| off | computer_type_500 | 124.0 | 129.6 | 136.5 | 0 | 20/20 |
