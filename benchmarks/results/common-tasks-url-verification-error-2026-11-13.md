# Common task benchmark

All requested attempts recorded. Successful measurements require independently verified outcomes.

| Operation / strategy | Passed / attempted | Median ms | Observed p95 ms | Failed / timeout / blocked | MCP calls |
| --- | ---: | ---: | ---: | ---: | --- |
| window_discovery:baseline | 5/5 | 19.7 | 22.1 | 0/0/0 | 1, 1, 1, 1, 1 |
| window_discovery:optimized | 5/5 | 17.4 | 19.4 | 0/0/0 | 1, 1, 1, 1, 1 |
| control_discovery:baseline | 5/5 | 84.1 | 92.9 | 0/0/0 | 1, 1, 1, 1, 1 |
| control_discovery:optimized | 5/5 | 119.1 | 129.8 | 0/0/0 | 1, 1, 1, 1, 1 |
| enter_text_verify:baseline | 5/5 | 376.0 | 436.0 | 0/0/0 | 4, 4, 4, 4, 4 |
| enter_text_verify:optimized | 5/5 | 389.3 | 398.7 | 0/0/0 | 2, 2, 2, 2, 2 |
| search_and_open:baseline | 5/5 | 1522.4 | 1534.0 | 0/0/0 | 10, 10, 10, 10, 10 |
| search_and_open:optimized | 5/5 | 1271.5 | 1286.6 | 0/0/0 | 4, 4, 4, 4, 4 |
| button_result:baseline | 5/5 | 613.1 | 657.6 | 0/0/0 | 3, 3, 3, 3, 3 |
| button_result:optimized | 5/5 | 617.8 | 618.5 | 0/0/0 | 2, 2, 2, 2, 2 |
| document_passages:baseline | 5/5 | 533.7 | 543.3 | 0/0/0 | 2, 2, 2, 2, 2 |
| document_passages:optimized | 5/5 | 276.5 | 290.4 | 0/0/0 | 1, 1, 1, 1, 1 |
| url_open:baseline | 5/5 | 1002.7 | 1018.9 | 0/0/0 | 8, 8, 8, 8, 8 |
| url_open:optimized | 5/5 | 991.0 | 1020.9 | 0/0/0 | 5, 5, 5, 5, 5 |
| pdf_open_read:baseline | 0/0 | — | — | 0/0/5 | — |
| pdf_open_read:optimized | 0/0 | — | — | 0/0/5 | — |
| excel_read:baseline | 5/5 | 420.7 | 452.7 | 0/0/0 | 10, 10, 10, 10, 10 |
| excel_read:optimized | 5/5 | 63.2 | 72.0 | 0/0/0 | 1, 1, 1, 1, 1 |
| excel_write_calculate_save:baseline | 5/5 | 1157.5 | 1306.3 | 0/0/0 | 12, 12, 12, 12, 12 |
| excel_write_calculate_save:optimized | 5/5 | 719.9 | 837.7 | 0/0/0 | 3, 3, 3, 3, 3 |

This is an execution benchmark of shared operations in real Edge and desktop Excel with owned synthetic data, not a test of Zalo, Teams, Outlook, SharePoint, Drive, Dicreto or GS1 integrations.

Baseline and optimized are alternative execution strategies in the same build, not a historical Git-revision comparison. Window discovery uses the same strategy as a noise reference.

Timers start at the first MCP request and end after outcome verification. Model inference, user-request intake, startup/tab preparation and per-case fixture setup are excluded.

One warmup per case/strategy is excluded. Order reverses across paired rounds. App/OS/network caches are not reset; PDF cases use new URLs.

Opening an actual PDF is insufficient: its seeded text must be retrieved through MCP. Unsupported accessibility is reported as blocked.

Full workflow elapsed includes independent server or Excel verification. Action and verification durations are also reported separately. Native spans overlap and are not added to totals.

A failed scenario is not replayed. Remaining scheduled rows are recorded as blocked. Failures/timeouts are preserved alongside successful distributions.

Small-sample p95 is the slowest observed sample. These timings do not predict arbitrary cloud loading or AI-client latency.

pdf_open_read: Earlier failed: Expected values to be strictly equal:
+ actual - expected

+ '127.0.0.1:50155/invoice-ceaea23f-6044b0.pdf'
- 'http://127.0.0.1:50155/invoice-ceaea23f-6044b0.pdf'
; no action replay.

Benchmark tab left open: The expression evaluated to a falsy value:

  assert(address.nodes[0].value.startsWith(baseUrl + '/') && address.nodes[0].value.includes(nonce))
