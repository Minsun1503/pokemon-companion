# Common task benchmark

All requested attempts recorded. Successful measurements require independently verified outcomes.

| Operation / strategy | Passed / attempted | Median ms | Observed p95 ms | Failed / timeout / blocked | MCP calls |
| --- | ---: | ---: | ---: | ---: | --- |
| window_discovery:baseline | 5/5 | 14.1 | 14.4 | 0/0/0 | 1, 1, 1, 1, 1 |
| window_discovery:optimized | 5/5 | 14.4 | 17.0 | 0/0/0 | 1, 1, 1, 1, 1 |
| control_discovery:baseline | 5/5 | 91.9 | 93.8 | 0/0/0 | 1, 1, 1, 1, 1 |
| control_discovery:optimized | 5/5 | 126.3 | 150.4 | 0/0/0 | 1, 1, 1, 1, 1 |
| enter_text_verify:baseline | 5/5 | 399.3 | 413.8 | 0/0/0 | 4, 4, 4, 4, 4 |
| enter_text_verify:optimized | 5/5 | 399.5 | 418.7 | 0/0/0 | 2, 2, 2, 2, 2 |
| search_and_open:baseline | 5/5 | 1572.7 | 1609.4 | 0/0/0 | 10, 10, 10, 10, 10 |
| search_and_open:optimized | 5/5 | 1306.8 | 1320.9 | 0/0/0 | 4, 4, 4, 4, 4 |
| button_result:baseline | 5/5 | 614.8 | 638.0 | 0/0/0 | 3, 3, 3, 3, 3 |
| button_result:optimized | 5/5 | 606.6 | 677.4 | 0/0/0 | 2, 2, 2, 2, 2 |
| document_passages:baseline | 5/5 | 549.9 | 558.1 | 0/0/0 | 2, 2, 2, 2, 2 |
| document_passages:optimized | 5/5 | 274.5 | 279.4 | 0/0/0 | 1, 1, 1, 1, 1 |
| url_open:baseline | 5/5 | 1031.0 | 1048.0 | 0/0/0 | 8, 8, 8, 8, 8 |
| url_open:optimized | 5/5 | 1022.9 | 1038.2 | 0/0/0 | 5, 5, 5, 5, 5 |
| pdf_open_read:baseline | 5/5 | 1316.8 | 1319.0 | 0/0/0 | 10, 10, 10, 10, 10 |
| pdf_open_read:optimized | 5/5 | 1292.3 | 1311.8 | 0/0/0 | 7, 7, 7, 7, 7 |
| excel_read:baseline | 5/5 | 424.3 | 477.7 | 0/0/0 | 10, 10, 10, 10, 10 |
| excel_read:optimized | 5/5 | 66.6 | 67.4 | 0/0/0 | 1, 1, 1, 1, 1 |
| excel_write_calculate_save:baseline | 5/5 | 1201.5 | 1286.1 | 0/0/0 | 12, 12, 12, 12, 12 |
| excel_write_calculate_save:optimized | 5/5 | 745.2 | 822.8 | 0/0/0 | 3, 3, 3, 3, 3 |

This is an execution benchmark of shared operations in real Edge and desktop Excel with owned synthetic data, not a test of Zalo, Teams, Outlook, SharePoint, Drive, Dicreto or GS1 integrations.

Baseline and optimized are alternative execution strategies in the same build, not a historical Git-revision comparison. Window discovery uses the same strategy as a noise reference.

Timers start at the first MCP request and end after outcome verification. Model inference, user-request intake, startup/tab preparation and per-case fixture setup are excluded.

One warmup per case/strategy is excluded. Order reverses across paired rounds. App/OS/network caches are not reset; PDF cases use new URLs.

Opening an actual PDF is insufficient: its seeded text must be retrieved through MCP. Unsupported accessibility is reported as blocked.

Full workflow elapsed includes independent server or Excel verification. Action and verification durations are also reported separately. Native spans overlap and are not added to totals.

A failed scenario is not replayed. Remaining scheduled rows are recorded as blocked. Failures/timeouts are preserved alongside successful distributions.

Small-sample p95 is the slowest observed sample. These timings do not predict arbitrary cloud loading or AI-client latency.


