# Common task benchmark

All requested attempts recorded. Successful measurements require independently verified outcomes.

| Operation / strategy | Passed / attempted | Median ms | Observed p95 ms | Failed / timeout / blocked | MCP calls |
| --- | ---: | ---: | ---: | ---: | --- |
| window_discovery:baseline | 1/1 | 12.0 | 12.0 | 0/0/0 | 1 |
| window_discovery:optimized | 1/1 | 15.5 | 15.5 | 0/0/0 | 1 |
| control_discovery:baseline | 1/1 | 77.7 | 77.7 | 0/0/0 | 1 |
| control_discovery:optimized | 1/1 | 104.6 | 104.6 | 0/0/0 | 1 |
| enter_text_verify:baseline | 1/1 | 344.0 | 344.0 | 0/0/0 | 4 |
| enter_text_verify:optimized | 1/1 | 336.1 | 336.1 | 0/0/0 | 2 |
| search_and_open:baseline | 1/1 | 1452.3 | 1452.3 | 0/0/0 | 10 |
| search_and_open:optimized | 1/1 | 1136.3 | 1136.3 | 0/0/0 | 4 |
| button_result:baseline | 1/1 | 555.1 | 555.1 | 0/0/0 | 3 |
| button_result:optimized | 1/1 | 584.2 | 584.2 | 0/0/0 | 2 |
| document_passages:baseline | 1/1 | 474.1 | 474.1 | 0/0/0 | 2 |
| document_passages:optimized | 1/1 | 260.1 | 260.1 | 0/0/0 | 1 |
| url_open:baseline | 1/1 | 933.0 | 933.0 | 0/0/0 | 8 |
| url_open:optimized | 1/1 | 915.8 | 915.8 | 0/0/0 | 5 |
| pdf_open_read:baseline | 0/0 | — | — | 0/0/1 | — |
| pdf_open_read:optimized | 0/0 | — | — | 0/0/1 | — |
| excel_read:baseline | 1/1 | 437.3 | 437.3 | 0/0/0 | 10 |
| excel_read:optimized | 1/1 | 64.2 | 64.2 | 0/0/0 | 1 |
| excel_write_calculate_save:baseline | 1/1 | 1173.1 | 1173.1 | 0/0/0 | 12 |
| excel_write_calculate_save:optimized | 1/1 | 638.3 | 638.3 | 0/0/0 | 3 |

This is an execution benchmark of shared operations in real Edge and desktop Excel with owned synthetic data, not a test of Zalo, Teams, Outlook, SharePoint, Drive, Dicreto or GS1 integrations.

Timers start at the first MCP request and end after outcome verification. Model inference, user-request intake, startup/tab preparation and per-case fixture setup are excluded.

One warmup per case/strategy is excluded. Order reverses across paired rounds. App/OS/network caches are not reset; PDF cases use new URLs.

Opening an actual PDF is insufficient: its seeded text must be retrieved through MCP. Unsupported accessibility is reported as blocked.

Full workflow elapsed includes independent server or Excel verification. Action and verification durations are also reported separately. Native spans overlap and are not added to totals.

A failed scenario is not replayed. Remaining scheduled rows are recorded as blocked. Failures/timeouts are preserved alongside successful distributions.

Small-sample p95 is the slowest observed sample. These timings do not predict arbitrary cloud loading or AI-client latency.

pdf_open_read: Earlier failed: Multiple live controls match the captured identity. Call get_ui again.; no action replay.

Benchmark tab left open: The expression evaluated to a falsy value:

  assert(address.nodes[0].value.startsWith(baseUrl + '/'))
