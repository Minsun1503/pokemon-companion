# Common task benchmark

All requested attempts recorded. Successful measurements require independently verified outcomes.

| Operation / strategy | Passed / attempted | Median ms | Observed p95 ms | Failed / timeout / blocked | MCP calls |
| --- | ---: | ---: | ---: | ---: | --- |
| control_discovery:baseline | 1/1 | 72.7 | 72.7 | 0/0/0 | 1 |
| control_discovery:optimized | 1/1 | 93.6 | 93.6 | 0/0/0 | 1 |
| enter_text_verify:baseline | 0/0 | — | — | 0/0/1 | — |
| enter_text_verify:optimized | 0/0 | — | — | 0/0/1 | — |
| search_and_open:baseline | 0/0 | — | — | 0/0/1 | — |
| search_and_open:optimized | 0/0 | — | — | 0/0/1 | — |

This is an execution benchmark of shared operations in real Edge and desktop Excel with owned synthetic data, not a test of Zalo, Teams, Outlook, SharePoint, Drive, Dicreto or GS1 integrations.

Timers start at the first MCP request and end after outcome verification. Model inference, user-request intake, startup/tab preparation and per-case fixture setup are excluded.

One warmup per case/strategy is excluded. Order reverses across paired rounds. App/OS/network caches are not reset; PDF cases use new URLs.

Opening an actual PDF is insufficient: its seeded text must be retrieved through MCP. Unsupported accessibility is reported as blocked.

Full workflow elapsed includes independent server or Excel verification. Action and verification durations are also reported separately. Native spans overlap and are not added to totals.

A failed scenario is not replayed. Remaining scheduled rows are recorded as blocked. Failures/timeouts are preserved alongside successful distributions.

Small-sample p95 is the slowest observed sample. These timings do not predict arbitrary cloud loading or AI-client latency.

enter_text_verify: Earlier failed: expect_value is supported atomically only by wait_for; use batch for a get_ui expectation.; no action replay.

search_and_open: Earlier failed: expect_value is supported atomically only by wait_for; use batch for a get_ui expectation.; no action replay.

Benchmark tab left open: The expression evaluated to a falsy value:

  assert(address.nodes[0].value.startsWith(baseUrl + '/'))
