# Common task benchmark

All requested attempts recorded. Successful measurements require independently verified outcomes.

| Operation / strategy | Passed / attempted | Median ms | Observed p95 ms | Failed / timeout / blocked | MCP calls |
| --- | ---: | ---: | ---: | ---: | --- |
| pdf_open_read:baseline | 1/1 | 1179.1 | 1179.1 | 0/0/0 | 9 |
| pdf_open_read:optimized | 1/1 | 1106.4 | 1106.4 | 0/0/0 | 6 |

This is an execution benchmark of shared operations in real Edge and desktop Excel with owned synthetic data, not a test of Zalo, Teams, Outlook, SharePoint, Drive, Dicreto or GS1 integrations.

Baseline and optimized are alternative execution strategies in the same build, not a historical Git-revision comparison. Window discovery uses the same strategy as a noise reference.

Timers start at the first MCP request and end after outcome verification. Model inference, user-request intake, startup/tab preparation and per-case fixture setup are excluded.

One warmup per case/strategy is excluded. Order reverses across paired rounds. App/OS/network caches are not reset; PDF cases use new URLs.

Opening an actual PDF is insufficient: its seeded text must be retrieved through MCP. Unsupported accessibility is reported as blocked.

Full workflow elapsed includes independent server or Excel verification. Action and verification durations are also reported separately. Native spans overlap and are not added to totals.

A failed scenario is not replayed. Remaining scheduled rows are recorded as blocked. Failures/timeouts are preserved alongside successful distributions.

Small-sample p95 is the slowest observed sample. These timings do not predict arbitrary cloud loading or AI-client latency.
