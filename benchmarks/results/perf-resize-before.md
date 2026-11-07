# Desktop tool benchmark

20 measured runs per scenario and UI mode. Failed native typing checks are preserved and counted, not retried or treated as success. Nested spans overlap: worker/tree/post-processing and serialization are included in action; capture_hide/show are included in companion_before/after. Tool total excludes SDK framing; client elapsed includes stdio. Cold start also includes server connection. Fixture setup and independent verification are outside timers.

| Companion | Scenario | Min ms | Median ms | p95 ms | Image bytes | Verified |
|---|---|---:|---:|---:|---:|---:|
| on | computer_get_screenshot | 600.6 | 828.3 | 1287.0 | 158841.5 | 20/20 |
| off | computer_get_screenshot | 582.2 | 683.2 | 875.1 | 159079.5 | 20/20 |
