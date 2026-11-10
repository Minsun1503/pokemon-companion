# Improving Pokémon Companion using agent-desktop

Reviewed November 9, 2026: the local `pokemon-companion` checkout at `348d98c` and the local reference directory `agent-desktop` at `b43ac4f6`. This is a source comparison of those checkouts, not a comparison of the latest remote releases. Existing changes to `backend/scripts/copy-native.mjs` and `backend/src/windows/automation.ts` were present before the review and retained.

Pokémon Companion should keep its Electron presentation, direct MCP connection, and persistent Windows worker. The most useful lessons from agent-desktop concern reliable execution contracts, observation coverage, target identity, and verification. A Rust rewrite would introduce substantial integration and distribution work without evidence that it would improve this product.

## What is already shared

Both projects leave task planning to the connected agent. They expose native accessibility controls, qualify element identifiers by a snapshot, support batches, and expect observation after an action. Pokémon Companion's separate Talk feature is a character conversation, not the desktop-control planner.

Our implementation already has important strengths:

- [PokemonRuntime](../backend/src/pokemon/runtime.ts) serializes operations within the shared runtime, keeps whole batches exclusive, checks cancellation and user pauses, and coordinates overlay visibility.
- [WindowsAutomation](../backend/src/windows/automation.ts) keeps one worker alive. The native walker uses cached properties, live field values, response limits, and snapshot-qualified targets.
- [Windows batches](../backend/src/windows/batch.ts) prevalidate plans, reject ambiguous references, and avoid replaying inputs.
- [Course](course-api.md) and [Excel](excel-api.md) provide purpose-built operations, pagination, version checks, and evidence beyond generic clicking.
- [Desktop benchmarks](../benchmarks/README.md) and fixture checks already independently verify effects. Tests are not missing; they need broader automatic coverage.

The [recorded November 7 batch benchmark](../benchmarks/results/windows-batch-2026-11-07.md) reduced six MCP calls to one and result text by 64.7%, while its warm execution median changed by only 0.9%. That supports lower orchestration overhead, not a claim that native UI execution became dramatically faster. This review did not benchmark agent-desktop against Pokémon Companion.

## Architectural comparison

Reference links below are pinned to the inspected agent-desktop commit.

| Area | Pokémon Companion before this change | agent-desktop reference | Lesson for our project |
| --- | --- | --- | --- |
| Product boundary | Node/TypeScript MCP backend plus Electron pet; separate Talk feature | [Rust CLI and C library](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6/README.md), with an MCP command surface | Keep our presentation and specialized workflows; improve the execution layer independently. |
| Platform architecture | Direct Windows worker; generic mouse, keyboard, and screenshots elsewhere | [PlatformAdapter](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6/crates/core/src/adapter/mod.rs) and separate macOS, Windows, Linux crates | Define a small TypeScript adapter boundary before adding another native platform. |
| Command surface | Five Windows MCP tools with action enums; descriptions and validation maintained in several places | [MCP catalog generated from CLI commands](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6/src/mcp/mod.rs); batches use the same dispatch | Share an action catalog for validation, mutation policy, documentation, and tool schemas. Keep our compact batch tool. |
| Targets | In-memory element proxies, runtime IDs, two-minute expiry, and window-ancestry checks | [Process-instance and window identity checks](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6/crates/windows/src/tree/resolve/mod.rs), with strict capture-proof resolution | Strengthen identity checks for virtualized/reused controls and reused window handles. |
| Errors | Native failures mostly become strings; batches report step progress; Course/Excel have their own evidence | [Delivery and retry semantics](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6/crates/core/src/actions/delivery_semantics.rs) and a [versioned envelope](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6/crates/core/src/response/output.rs) | Make execution uncertainty machine-readable without silently changing every existing success response. |
| Observation | Flat filtered nodes, node/depth/time limits, `truncated`; native window enumeration had an unreported cap | [Complete/partial snapshots, skeleton and subtree reads](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6/crates/core/src/commands/snapshot.rs) | Correct completeness first; add scoped discovery for dense applications later. |
| Verification | Unit tests, real fixtures, documented benchmark runs, and manually invoked smoke checks | [CI](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6/.github/workflows/ci.yml), platform E2E, contract checks, architecture checks | Run existing quality checks on pull requests and add focused native regression coverage. |
| Diagnostics | Timing spans and pet status; platform limits described in README | [Status](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6/crates/core/src/commands/status.rs), permissions, capabilities, and version-matched agent guides | Add a desktop-backend status operation so clients can choose supported actions before failing. |
| Distribution | Self-contained Windows ZIP/MCPB bundles with Node, Electron, and native dependencies | Native CLI/library archives with enforced size limits | Test packaged artifacts and align versions. The reference's 15 MiB binary target is not an appropriate Electron bundle target. |

## Highest-priority improvements implemented here

### 1. Execution and retry evidence

Added [typed desktop errors](../backend/src/utils/errors.ts), carried explicit native rejection evidence through the PowerShell/Node boundary, and exposed `error_details` from atomic Windows errors and stopped batches.

Known stale-target checks report `STALE_REF`, `not_delivered`, and a safe retry requiring a new snapshot. An invocation that loses its worker response reports uncertain delivery and an unsafe retry. Plain error text is never used to infer that an input was not sent. Cancellation and user pause failures do not encourage automatic retries.

Launch polling accounts for an earlier launch attempt: a later timeout, cancellation, or discovery failure cannot label repeating the launch as safe. Batch disposition applies to the stopped step, with `retry_scope: "stopped_step"`; successful earlier steps stay applied.

The existing batch `error` string and successful response shapes remain usable. Discovery gains additive completeness fields. SDK schema errors and other tools retain their existing contracts. Full details are in the [Windows API contract](windows-api.md).

### 2. Accurate discovery coverage

The native window list previously stopped at 100 matches without a truncation marker. It now looks for an additional match before deciding: exactly 100 can be complete; a 101st proves truncation. Node-level response trimming also marks discovery incomplete.

UI reads now report incomplete coverage when an unavailable provider causes a branch to be skipped. Batch targeting therefore refuses to treat a partially observed query as a unique control. Completeness concerns accessibility data within the requested scope and budgets; it cannot prove that inaccessible controls do not exist.

### 3. Checks before merging

Added a [Windows pull-request workflow](../.github/workflows/ci.yml) with read-only repository permissions, cancellation of superseded runs, a timeout, lockfile-based installation, formatting/lint checks, tests, the production build, and the native contract check.

`npm run setup:ci` uses `npm ci` for both components and retains Electron runtime verification. The release workflow remains responsible for release artifacts. The new workflow has been inspected locally; a GitHub-hosted run has not yet been observed.

The [native contract check](../scripts/windows-contract-smoke.mjs) exercises the production worker with owned windows outside the visible display, verifies the exact and overflow cases, and checks native stale-target/window rejection metadata. It does not depend on screenshots or the pet overlay.

## Initial implementation priorities

These priorities were recorded in the first comparison. The [adoption audit](reference-adoption.md) tracks subsequent implementation and remaining requirements.

| Priority | Improvement | Acceptance evidence |
| --- | --- | --- |
| P1 | Record process instance, window identity, role, automation ID, and stable accessible identity with each target. Refuse changed or ambiguous identity. Preserve live values as state, not identity. | A virtualized control reused for a different item is rejected; a replaced process/window is rejected; ordinary value changes still allow the original field to be used. Verify across WinForms and Electron. |
| P1 | Extend delivery and verified-result semantics consistently to `computer`, Course, and Excel. Add an explicit response-contract version when adopting a shared envelope. | Error metadata survives MCP transport for each tool; partial typing/writes remain identifiable; a dispatched input is never presented as proof that a document was saved or a transaction completed. |
| P1 | Add skeleton/subtree discovery and bounded waits for state transitions, including disappearance. Pin waits to the observed process/window. | Dense app scenarios need less response text; incomplete subtrees are reported; an unrelated window cannot satisfy a wait. |
| P1 | Add a backend status/capability operation distinct from pet status. | Report OS, worker readiness, supported native actions, known limitations, and actionable startup failures without requiring a failed input. |
| P2 | Extract an action catalog and a small DesktopAdapter interface. Keep specialized Course/Excel logic above that boundary. | Atomic and batch paths share validation and execution policy; adding an action cannot omit its metadata or tests; another platform can be added without editing the pet renderer. |
| P2 | Add scheduled/manual native E2E and packaged-artifact checks; turn documented regressions into targeted checks. | WinForms and Electron independently confirm each effect; packaged launch/configuration works in isolated folders; timing reports include artifact hashes and scenario-specific before/after samples. |
| P2 | Consolidate agent-facing guidance and version information. | README, MCP instructions, tool descriptions, package manifest, installers, and runtime identify compatible versions and enforce the same pause/retry rules. |

There is no measured justification here for replacing the Windows worker with the reference binary, importing its entire command set, or removing the existing specialized tools. If an optional agent-desktop adapter is considered later, compare real workflows with the pet enabled, handle version compatibility explicitly, and preserve licensing/attribution for any reused source. This implementation applies design ideas without copying reference source.

## Validation

The starting backend suite passed 174 tests with one skipped test. After the implementation, 188 backend tests passed with one skipped test, including MCP transport and retry-evidence cases. The five existing chat/animation tests passed. Backend lint/type checks and the frontend checks passed; the production Windows worker compiled, and the native contract check passed.

The reference repository was inspected without modification or native build. The review does not establish feature parity, cross-platform support for our project, or a performance improvement between the two engines. The GitHub workflow has not been run remotely.

## Continuation on November 10, 2026

Completed the interrupted identity implementation and added named-container skeletons, proof-qualified subtree reads, window identity tokens, pinned absence/state waits, a bounded read-only desktop status tool, queue cancellation, a shared Windows action catalog, and delivery evidence through computer/Course/Excel MCP responses. Generic input explicitly leaves effects unverified and attempts key/drag/clipboard cleanup. The [Windows contract](windows-api.md) documents compatibility and limitations.

The [November 9 identity benchmark](../benchmarks/results/identity-proof-2026-11-09.json) measured an earlier, smaller fixture: warm native SetValue median rose from 5.66 ms to 57.45 ms. The [November 10 dense report](../benchmarks/results/identity-cache-2026-11-10.json) measured 4.93 ms to 307.75 ms with 30 unrelated fields and 16 independently verified edits. The extra full scan trades latency for capture/live uniqueness checks; it is not a performance improvement. [Scoped discovery](../benchmarks/results/scoped-discovery-2026-11-10.json) reduced returned context by about 92% in owned WinForms and Electron fixtures. Cross-process coordination is now implemented and verified. The adoption audit records packaged verification and remaining work, including same-process HWND generation checks, broader provider coverage and multi-display capture.
