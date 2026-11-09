# Desktop automation support

The `windows` MCP tool retains its name for compatibility. Windows uses the native C# UI Automation worker. macOS and Linux use an optional bridge to [Vercel Labs agent-desktop](https://github.com/vercel-labs/agent-desktop), installed separately on PATH. This bridge accepts JSON contract **2.6** only; an absent CLI, malformed response, incompatible version or upstream failure is an error. There are no AppleScript, wmctrl or xdotool fallbacks and no automatic installation or input retries.

## Targets and observations

`get_windows` returns native window IDs. Windows IDs are decimal handles; other platforms return opaque strings. Pass the returned ID unchanged to `get_ui` or `activate`. A control `query` matches its name or native automation ID locally, and `control_type` matches its role. `query` on `get_windows` also matches the process/application name.

Local snapshots use 32 lowercase hex characters on every platform. Control actions accept `snapshot` + `element_id` or `@s<snapshot>:e<element_id>`. If both forms are supplied, they must agree. macOS/Linux snapshots map each local element to its exact original agent-desktop ref; they never construct upstream refs from local IDs. The cache is per automation instance, expires after 120 seconds and retains at most eight snapshots. Upstream 2.6 also checks native target identity before delivery.

Partial trees, exhausted scan budgets and clipped values remain explicit. `truncated` prevents batch target selection from treating an incomplete result as a unique match. `value_clipped` prevents `wait_for` from treating an abbreviated field value as an exact match. Disabled controls expose no supported actions, and protected/hidden/offscreen subtrees are excluded.

Windows Chromium/Electron traversal skips logical depth increments for anonymous, non-actionable Group/Custom/Pane wrappers only. Root tracking is independent of logical depth, so siblings of flattened wrappers remain visible. Non-wrapper controls at `max_depth` remain included. The existing 2,500-node and eight-second limits still bound traversal.

## Actions and limits

On macOS/Linux, supported actions are mapped from observed native capabilities: invoke/click, set_value, focus, toggle, expand, collapse and scroll. `select` is deliberately unsupported because upstream selection requires an option value and has different semantics from Windows tab/item selection. Native platform policies may reject any supported action, including focus or scroll; those errors are preserved, without enabling headed input or trying another delivery method.

`set_value` sends UTF-8 through stdin and preserves empty strings and newlines. `read_text` uses `agent-desktop get --property text`, which can use saved snapshot text; it is not a guarantee of live field verification. Successful native actions preserve their delivery/retry disposition and observed post-state. Success alone is not proof of application effects; observe again. Cancellation, pause and timeout stop waiting, invalidate bridge refs and report possible delivery uncertainty.

`activate` uses `focus-window --window-id`. macOS/Linux `launch` supports an application name only; this bridge rejects URLs and paths. It accepts upstream process launch without an initial window, then the shared helper polls for a matching window. Windows keeps executable, Start Menu and URL launch behavior. Foreground-guarded physical keyboard input remains Windows-only.

## Validation

`backend/src/windows/cross-platform.test.ts` exercises documented 2.6 response fixtures for macOS and Linux, exact target mapping, errors, capability checks, clipping and interruption. These are contract tests run on Windows, not live tests on macOS/Linux. Live native-host validation is still needed before claiming those hosts are fully verified.

Windows smoke scripts exercise native UI Automation against owned test windows. The benchmark files in `benchmarks/results/windows-batch-2026-11-09.*` describe the original submitted benchmark run; their numbers are historical and do not establish bridge correctness or performance on other hosts.
