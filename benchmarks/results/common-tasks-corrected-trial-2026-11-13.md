# Common task benchmark

All requested attempts recorded. Successful measurements require independently verified outcomes.

| Operation / strategy | Passed / attempted | Median ms | Observed p95 ms | Failed / timeout / blocked | MCP calls |
| --- | ---: | ---: | ---: | ---: | --- |
| window_discovery:baseline | 1/1 | 12.9 | 12.9 | 0/0/0 | 1 |
| window_discovery:optimized | 1/1 | 10.9 | 10.9 | 0/0/0 | 1 |
| control_discovery:baseline | 1/1 | 69.6 | 69.6 | 0/0/0 | 1 |
| control_discovery:optimized | 1/1 | 96.5 | 96.5 | 0/0/0 | 1 |
| enter_text_verify:baseline | 1/1 | 380.6 | 380.6 | 0/0/0 | 4 |
| enter_text_verify:optimized | 1/1 | 366.0 | 366.0 | 0/0/0 | 2 |
| search_and_open:baseline | 0/0 | — | — | 0/0/1 | — |
| search_and_open:optimized | 0/0 | — | — | 0/0/1 | — |
| button_result:baseline | 0/0 | — | — | 0/0/1 | — |
| button_result:optimized | 0/0 | — | — | 0/0/1 | — |
| document_passages:baseline | 0/0 | — | — | 0/0/1 | — |
| document_passages:optimized | 0/0 | — | — | 0/0/1 | — |
| url_open:baseline | 0/0 | — | — | 0/0/1 | — |
| url_open:optimized | 0/0 | — | — | 0/0/1 | — |
| pdf_open_read:baseline | 0/0 | — | — | 0/0/1 | — |
| pdf_open_read:optimized | 0/0 | — | — | 0/0/1 | — |
| excel_read:baseline | 1/1 | 365.1 | 365.1 | 0/0/0 | 10 |
| excel_read:optimized | 1/1 | 56.7 | 56.7 | 0/0/0 | 1 |
| excel_write_calculate_save:baseline | 1/1 | 1173.0 | 1173.0 | 0/0/0 | 12 |
| excel_write_calculate_save:optimized | 1/1 | 754.9 | 754.9 | 0/0/0 | 3 |

This is an execution benchmark of shared operations in real Edge and desktop Excel with owned synthetic data, not a test of Zalo, Teams, Outlook, SharePoint, Drive, Dicreto or GS1 integrations.

Timers start at the first MCP request and end after outcome verification. Model inference, user-request intake, startup/tab preparation and per-case fixture setup are excluded.

One warmup per case/strategy is excluded. Order reverses across paired rounds. App/OS/network caches are not reset; PDF cases use new URLs.

Opening an actual PDF is insufficient: its seeded text must be retrieved through MCP. Unsupported accessibility is reported as blocked.

Full workflow elapsed includes independent server or Excel verification. Action and verification durations are also reported separately. Native spans overlap and are not added to totals.

A failed scenario is not replayed. Remaining scheduled rows are recorded as blocked. Failures/timeouts are preserved alongside successful distributions.

Small-sample p95 is the slowest observed sample. These timings do not predict arbitrary cloud loading or AI-client latency.

search_and_open: Earlier timed_out: Expected state did not become ready within 15000 ms.; no action replay.

button_result: Earlier failed: Windows blocked foreground activation. Retry once; get_ui/invoke/set_value often work in the background. Re-read its UI and use windows focus on a known control when available.; no action replay.

document_passages: Earlier failed: Windows blocked foreground activation. Retry once; get_ui/invoke/set_value often work in the background. Re-read its UI and use windows focus on a known control when available.; no action replay.

url_open: Earlier failed: Windows blocked foreground activation. Retry once; get_ui/invoke/set_value often work in the background. Re-read its UI and use windows focus on a known control when available.; no action replay.

pdf_open_read: Earlier failed: Windows blocked foreground activation. Retry once; get_ui/invoke/set_value often work in the background. Re-read its UI and use windows focus on a known control when available.; no action replay.

Benchmark tab left open: The expression evaluated to a falsy value:

  assert(address.nodes[0].value.startsWith(baseUrl + '/'))
