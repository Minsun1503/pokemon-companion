# Common task benchmark

All requested attempts recorded. Successful measurements require independently verified outcomes.

| Operation / strategy | Passed / attempted | Median ms | Observed p95 ms | Failed / timeout / blocked | MCP calls |
| --- | ---: | ---: | ---: | ---: | --- |
| window_discovery:baseline | 0/0 | — | — | 0/0/1 | — |
| window_discovery:optimized | 0/0 | — | — | 0/0/1 | — |
| control_discovery:baseline | 0/0 | — | — | 0/0/1 | — |
| control_discovery:optimized | 0/0 | — | — | 0/0/1 | — |
| enter_text_verify:baseline | 0/0 | — | — | 0/0/1 | — |
| enter_text_verify:optimized | 0/0 | — | — | 0/0/1 | — |
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
| excel_read:baseline | 1/1 | 420.2 | 420.2 | 0/0/0 | 10 |
| excel_read:optimized | 1/1 | 68.9 | 68.9 | 0/0/0 | 1 |
| excel_write_calculate_save:baseline | 1/1 | 1160.5 | 1160.5 | 0/0/0 | 12 |
| excel_write_calculate_save:optimized | 1/1 | 675.6 | 675.6 | 0/0/0 | 3 |

This is an execution benchmark of shared operations in real Edge and desktop Excel with owned synthetic data, not a test of Zalo, Teams, Outlook, SharePoint, Drive, Dicreto or GS1 integrations.

Timers start at the first MCP request and end after outcome verification. Model inference, user-request intake, startup/tab preparation and per-case fixture setup are excluded.

One warmup per case/strategy is excluded. Order reverses across paired rounds. App/OS/network caches are not reset; PDF cases use new URLs.

Opening an actual PDF is insufficient: its seeded text must be retrieved through MCP. Unsupported accessibility is reported as blocked.

Full workflow elapsed includes independent server or Excel verification. Action and verification durations are also reported separately. Native spans overlap and are not added to totals.

A failed scenario is not replayed. Remaining scheduled rows are recorded as blocked. Failures/timeouts are preserved alongside successful distributions.

Small-sample p95 is the slowest observed sample. These timings do not predict arbitrary cloud loading or AI-client latency.

window_discovery: Earlier timed_out: wait_for timed out after 15000 ms waiting for Common Tasks 1ac80202-b679dd. After an interrupted wait, call get_ui again for fresh snapshots.; no action replay.

control_discovery: Earlier timed_out: wait_for timed out after 15000 ms waiting for Common Tasks 1ac80202-48cab0. After an interrupted wait, call get_ui again for fresh snapshots.; no action replay.

enter_text_verify: Earlier timed_out: wait_for timed out after 15000 ms waiting for Common Tasks 1ac80202-79f9e2. After an interrupted wait, call get_ui again for fresh snapshots.; no action replay.

search_and_open: Earlier failed: Unknown, expired or mismatched window identity. Call get_windows again.; no action replay.

button_result: Earlier failed: Unknown, expired or mismatched window identity. Call get_windows again.; no action replay.

document_passages: Earlier failed: Unknown, expired or mismatched window identity. Call get_windows again.; no action replay.

url_open: Earlier failed: Unknown, expired or mismatched window identity. Call get_windows again.; no action replay.

pdf_open_read: Earlier failed: Unknown, expired or mismatched window identity. Call get_windows again.; no action replay.

Benchmark tab left open: Unknown, expired or mismatched window identity. Call get_windows again.
