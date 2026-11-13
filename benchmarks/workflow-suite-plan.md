# Typical user workflow benchmark plan

Status: proposed suite. The existing scripts measure individual native operations, search/page retrieval, and some controlled workflows. The scenarios below have not been implemented or run against the user's platforms. Creating this plan does not send messages, modify cloud records, or change browser sessions.

## Two complementary measurements

**Execution mode:** a deterministic driver calls the repository's actual MCP tools. It measures discovery, app/URL opening, readiness, actions, retrieval, and verification. Reuse `scripts/client.mjs`, `POKEMON_TIMING=1`, the retrieval benchmark's reporting pattern, and native Excel verification. This isolates implementation changes from varying model choices.

**Agent mode:** submit the same natural-language task through the real intended AI client, which chooses tools normally. A client-side controller records request acceptance before model processing and observes completion. It must use the same model, settings, instructions, transport, and companion configuration for both builds. Existing server logs alone cannot establish the time a user submitted a request.

The existing `[pokemon-client-timing]` records response-to-next-request gaps when timing and task attribution are active. These gaps include client/model, transport, rendering, and possibly human waits; they must not be labeled pure inference time. Model identity/token usage should be recorded only when supplied by the client.

## Scenario catalog

Every scenario needs a named starting state, exact task parameters, timeout, verifier, and reset procedure. A single record or file is preferable to an open-ended request to read everything.

| Scenario | Typical task | Completion evidence |
| --- | --- | --- |
| Zalo / Teams conversation | Open the native app or configured web URL, find a benchmark conversation, retrieve a seeded message | Exact conversation identity plus a unique seeded message and expected returned fact |
| Outlook message | Open Outlook or its configured URL, find a seeded subject, read the body | Correct message identity and expected body fact; typing the subject into Search is insufficient |
| Message composition | Open a benchmark conversation and compose a unique draft | Correct recipient/conversation and exact draft text; sending is a separate explicitly configured scenario |
| SharePoint / Drive PDF | Open a configured site URL, find a benchmark PDF, open it, answer one seeded question | Correct file identity/version, required page or section, and the expected returned answer |
| SharePoint / Drive workbook | Open the site, select a benchmark workbook, then open it in the specified web or desktop Excel surface | Exact workbook identity and a known cell value; desktop and web Excel are separate scenarios |
| Desktop Excel edit | Open a disposable workbook copy, read a range, enter a formula or values, save | Correct workbook/sheet/range, expected values/calculated result, and persisted result after reopening |
| Dicreto / GS1 website | Open a configured URL, search a known record, choose it and invoke a specific control | Correct record identifier and the control's expected resulting state, panel, file, or confirmation |
| Cross-application workflow | Read a seeded message, follow its test document link, retrieve a fact, enter it into a disposable workbook | Message identity, document identity, expected fact, and saved workbook cell all agree |

PDF cases should include a text PDF and a scanned PDF as separate scenarios. Scanned content requires the configured visual/OCR route and must not be compared as though it used the same text-retrieval path. Website controls similarly need a UIA-supported case and a visual/keyboard fallback case where applicable.

## Clocks and outcomes

Record monotonic timestamps from one controller where possible. Do not subtract clocks from different processes without an explicitly measured alignment.

- `request_accepted`: real agent/client accepts the benchmark request; unavailable in execution-only mode.
- `first_tool_request`: the first tool call leaves the client.
- `first_tool_response`: the first tool response returns.
- `first_verified_effect`: the requested application visibly enters a useful state, such as the requested window becoming ready or the correct search result appearing. A dispatch receipt is not an effect verifier.
- `answer_available`: the expected returned information is available to the client, for reading tasks.
- `outcome_verified`: the entire scenario's success predicate is satisfied.
- `final_response`: the user's result is displayed, when the client exposes that event.

Report user-to-first-tool, user-to-first-verified-effect, user-to-verified-completion, and user-to-final-response where available. For read-only tasks, time to the first useful returned information is often more meaningful than a changed UI state. Execution mode reports first-MCP-call-to-verified-completion and must not advertise it as user-request latency.

Within each workflow, record separate sequential phases: discovery/opening, readiness, search/navigation, reading/editing, and verification. Keep per-tool native timing spans as nested diagnostics; do not add overlapping spans to manufacture a total. Include downloads and application startup when the scenario requires them. Also record MCP call count, response sizes, selected retrieval route, retries, fallback use, and verification overhead.

Each attempt has an outcome: `passed`, `failed`, `timed_out`, or `blocked`. Preserve elapsed time, stopped phase, and bounded evidence for every attempt. A wrong fast answer is a failure. Timeouts and failures are reported alongside successful latency distributions rather than silently discarded. No input is automatically replayed after uncertain delivery.

## Test data and session conditions

Use seeded benchmark messages, documents, conversations, and workbook copies. Synthetic content allows exact independent verification and keeps private message bodies out of public benchmark reports. Logs should store identifiers, hashes, and pass/fail assertions where possible. Test-data seed identifiers cannot also be the only model answer supplied in the request: the assistant must retrieve the expected information.

Native Zalo/Teams/Outlook targets and web URLs are distinct routes. Preserve the existing signed-in Edge profile and obtain fresh `window_id`/`window_ref` and element observations on every run. Do not create clean browser profiles for authenticated scenarios. A signed-in session is a test precondition; missing login is reported as blocked. Login itself is measured only in a separately specified login workflow.

Web Excel must be verified through its actual web surface; the desktop Excel COM helper is not evidence that a browser workbook was edited. Local file inspection or service-side read-only verification may independently check persisted test data, but the action path must still use the repository's production tools. A verifier must not perform a missing action or retrieve the answer on behalf of the assistant.

Compose drafts by default for messaging tests. An actual send requires a designated benchmark recipient/channel, explicit authorization, a unique run marker, and independent delivery evidence. Editing cloud records similarly requires designated test records. Such scenarios are not run against ordinary contacts or production data from generic workflow descriptions.

## Repetition and comparisons

1. Validate fixture identity, login/session state, and an accessible verifier before running the scenario. Record these preconditions.
2. Run one untimed warmup, then initially five measured attempts per scenario to diagnose failures.
3. For stable execution comparisons, target 20 warm attempts per build and alternate/randomize baseline and candidate order with a reset between attempts. Do not run builds, unit tests, or other benchmarks alongside timed attempts.
4. Measure cold app starts separately from existing-window activation. Cold means the app process is absent, not that OS/disk/browser caches were erased. Only close owned benchmark processes or use a manually prepared state; do not terminate an unrelated session containing user work.
5. Begin live and agent-mode testing with three to five attempts because each run involves remote services or model calls. Expand only after correctness is stable. Small-sample p95 must be labeled as the observed order statistic, not a reliable tail estimate.
6. Keep baseline/candidate conditions matched: machine, build hashes, client/model configuration, prompt, input data, start state, profile, UI language, companion setting, and network/cache conditions. Preserve raw samples and run order.

Present median, p95, range, sample count, success rate, failure/blocked counts, and total cost when actually available. Compare time for the same verified outcome. A speed improvement should not reduce success rate; noisy differences should remain observations rather than universal speedup claims. Keep per-scenario results even when presenting an aggregate.

## Harness layout to implement

- Common runner: timing, checkpoints, reporting, paired order, reset hooks, and failure classification.
- Scenario adapters: native conversation, web conversation, Outlook, site/file opening, PDF reading, desktop Excel, web Excel, and named website controls.
- Verifiers: seeded application text, fixture/server state, document identity and expected facts, and reopened workbook values.
- Separate private configuration: exact executable/title, authorized URL, expected accessible labels, test conversation/recipient, file/record IDs, starting state, and expected result. Do not commit credentials or private account data.
- Controlled fixtures for repeatable development checks, plus explicitly configured live scenarios on this machine. Live authenticated tests remain separate from unattended CI.

The current repository provides useful pieces: `scripts/bench.mjs`, `scripts/windows-benchmark.mjs`, `scripts/real-app-bench.mjs`, `scripts/information-retrieval-benchmark.mjs`, `scripts/excel-smoke.mjs`, and the timing utilities. They do not yet form this complete suite. In particular, `real-app-bench.mjs` measures window/control operations and same-value field updates, not chat reading or message delivery.

## Suggested first batch

Start with five concrete scenarios: open a signed-in site by URL, retrieve a seeded Teams/Zalo message, open/read one known PDF, edit/save/reopen a disposable Excel workbook, and invoke one specified Dicreto/GS1 control with a known resulting state. Add the cross-application workflow after each individual adapter passes.

The live configuration needs the actual URLs and application routes, designated test conversation/message, PDF/workbook copies, exact website record/control, and expected outcomes. These details are currently unspecified, so no live suite results are claimed. Automatic GitHub pushing remains paused.
