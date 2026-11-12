# Windows discovery and error contract

The `windows` MCP tool uses Win32 and UI Automation. It returns compact JSON in one text content block. Examples and actions are in the [main README](../README.md#tools).

Batch is the default request mode. Omit the top-level `action` and provide `steps` (1-16 sequential atomic actions). Explicit `action:"batch"` and explicit individual actions remain supported. Missing or malformed steps fail before execution; no actions are inferred from top-level fields. Once an input is chosen, batch it with `get_ui` or a bounded `wait_for`, then interpret that observation before choosing the next segment. Use an individual action when only one step is known.

For external MCP clients, this avoids a separate client turn just to request the known follow-up observation. It cannot choose an unknown future branch or reduce the client's model inference directly. See [client timing and reproduction](tool-selection.md) and the [measured dependent-workflow comparison](../benchmarks/results/tool-selection-2026-11-12.md).

## Discovery coverage

`get_windows` and `get_ui` return `complete` and `truncated`. A complete result covered the requested discovery scope within the native traversal and response budgets. It does not establish coverage of controls the application does not expose through accessibility.

Field previews in `get_ui` use values from the same fresh per-node cache as identity evidence. This avoids an additional provider read for each returned field; it is not an atomic whole-window snapshot. Explicit `read_text`, target revalidation, and post-action value verification still read fresh/live state. Text response trimming accounts for JSON escaping and preserves complete UTF-16 pairs when shortening the returned prefix.

`get_windows` keeps up to 100 native matches. Exactly 100 matches can be complete; finding a 101st sets `complete: false` and `truncated: true`. Lower `max_elements` and `max_chars` can truncate the returned list further. Narrow `query` rather than treating a partial list as exhaustive.

`get_ui` reports an incomplete result when its node, depth, time, or response budget is exhausted, or an unavailable provider prevents part of the traversal. `matched` is a lower bound when truncated. Batch control references require exactly one match from an untruncated result. Clipped values retain their separate `value_clipped` flag; use `read_text` for full values.

## Identity and scoped reads

Discovery returns an opaque `window_ref` alongside a window's numeric `id` when its process identity is verifiable. Preserve it with `window_id` on `get_ui`, `activate`, `wait_for`, Course, Excel, and guarded `computer key/type` calls. Batch `window_step` propagates it automatically. Window proofs track process start time, owning thread and native class, expire after two minutes, and retain at most 128 entries. Existing calls without the token remain compatible and lack this additional window precondition. Same-process, same-thread, same-class HWND recycling still needs a generation guard; these checks do not claim to solve that case.

Element snapshots record role, automation ID, stable accessible name/description and uniqueness at capture. Editable values are state, not identity. Every control operation resolves a unique live match in the original scope and checks identity immediately before dispatch. `targetable:false` means capture did not prove the control's identity. Identical accessible labels cannot distinguish semantically different items that expose the same complete identity; providers must supply distinguishing information.

`get_ui` with `view:"skeleton"` returns named containers and relative depth, omitting value previews. It performs the full identity traversal within `max_depth`, rather than granting action references from an incomplete shallow scan. To read a subtree, select a targetable container and pass:

```json
{"action":"get_ui","window_id":"12345","window_ref":"<returned token>","view":"skeleton","query":"Settings","max_depth":30}
{"action":"get_ui","window_id":"12345","window_ref":"<returned token>","root_snapshot":"<skeleton snapshot>","root_element_id":1,"max_depth":30}
```

The root must belong to the selected window and have a complete, unique capture. Scoped control actions verify both root and target and reject a control that moved outside the subtree. Up to four nested scopes are supported. Snapshot storage remains bounded to eight current snapshots; root proof chains retain their original expiry. Skeletons and subtrees reduce returned context for suitable layouts; the required identity scans can still add latency. No dense-app performance improvement is claimed by the fixture checks.

## Bounded state waits

`wait_for` supports `wait_condition:"present"` (default), `absent`, `enabled`, `disabled`, `selected`, and `unselected`. `expect_value` can additionally require an exact, unclipped value for presence/state waits. Polls keep the first observed `window_ref`, or the supplied token, so a replacement process cannot satisfy a wait. The timeout bounds native reads and delays; an unrelated window is never substituted.

Absence requires `snapshot` and `element_id` from an earlier complete whole-window observation of a unique control. The query must equal its captured stable name or automation ID; a supplied role must match. The original window proof is checked even if the control has already disappeared. Only a complete zero-match read proves absence within the exposed accessibility scope. Partial reads, provider failures and window disappearance are not absence evidence. This predicate concerns the accessible control's disappearance, including hiding, rather than deletion of an underlying business record.

```json
{"action":"wait_for","window_id":"12345","window_ref":"<returned token>","snapshot":"<prior snapshot>","element_id":1,"query":"Loading","control_type":"Text","wait_condition":"absent","timeout_ms":5000}
```

An absence wait uses explicit prior references; it does not use a batch `target_step`. Refresh expired observations before continuing. All ordinary native Windows actions now receive cancellation and pause monitoring, as do the second reads used for batch value verification. Closing a worker during input leaves delivery uncertain and invalidates its snapshots; inputs are never replayed.

## Backend readiness

`desktop` with `action:"status"` reports `contract_version:1`, OS, Node runtime, pause state, supported native actions/surfaces, and a probe of the actual native worker protocol. It works while paused without starting the pet. Queue time and native probing share a five-second budget; an expired or cancelled queued probe never runs later. Raw startup diagnostics are replaced with bounded guidance and an error code. A successful probe confirms the worker is responsive, not permission to control an elevated app or secure desktop. Primary-display capture/input and Windows-only native controls are reported as limits.

## Errors and retry evidence

Failures handled by `windows` set MCP `isError: true` and return:

```json
{
  "contract_version": 1,
  "ok": false,
  "error": "Unknown or expired element. Call get_ui again; do not reuse an old element id with a new snapshot.",
  "error_details": {
    "code": "STALE_REF",
    "disposition": { "delivery": "not_delivered", "retry": "safe" },
    "recovery": {
      "strategy": "refresh_snapshot_then_retry_original",
      "requires_fresh_snapshot": true
    }
  }
}
```

The existing `error` string is retained. `error_details` adds machine-readable evidence. Error text is clipped to `max_chars` when necessary, with `truncated: true`. SDK input-schema failures may still return ordinary MCP error text before the handler runs. Handled computer, Course, and Excel errors also carry `contract_version:1` and the same disposition fields, retaining their existing action/phase/input-state evidence. Successful generic input reports `verified:false`; native dispatch does not prove a save or submission. Course readiness and Excel verification retain their operation-specific meanings.

| Field value | Meaning |
| --- | --- |
| `delivery: not_delivered` | This request sent no mutating action, either because it was a read or because an explicit pre-action check rejected it. |
| `delivery: delivered` | A mutating dispatch was acknowledged before later verification failed. Its business effect may remain unverified; do not replay it. |
| `delivery: delivery_uncertain` | An input request was attempted and its effect is not established. Inspect the application before continuing. |
| `delivery: unknown` | The failure lacks enough evidence to classify delivery. |
| `retry: safe` | Repeating the failed operation does not risk duplicating an earlier mutation by that operation. Follow any recovery instruction first. |
| `retry: unsafe` | Do not automatically repeat the operation. This includes uncertain inputs, cancellation, user pauses, and invalid arguments. |
| `retry: unknown` | Inspect the application and failure before deciding what to do. |

Common codes include `INVALID_ARGS`, `STALE_REF`, `WINDOW_NOT_FOUND`, `ELEMENT_NOT_FOUND`, `AMBIGUOUS_TARGET`, `INCOMPLETE_SNAPSHOT`, `ACTION_NOT_SUPPORTED`, `EXPECTATION_FAILED`, `ACTION_FAILED`, `TIMEOUT`, `PAUSED`, `CANCELLED`, and `INTERNAL`. Classification uses explicit execution evidence. A message containing “no input was sent” does not by itself grant a safe retry.

The backend never retries an input automatically. `STALE_REF` requires new discovery and a fresh target. User pauses must be resumed by the user. A successful `launch` followed by a failed window lookup is unsafe to retry automatically, because another launch can duplicate the side effect.

Generic typing failures can include `error_details.progress` with `submitted_characters` and `total_characters`. These are acknowledged provider submissions, not verified field contents. A failed chunk may also have partially arrived. Later foreground rejection or cancellation cannot make replaying the whole string safe. Key and drag paths attempt held-input release after partial failures; Unicode typing attempts clipboard restoration even if the key path fails. Clipboard-restoration failures explicitly remain unsafe to retry. A named Windows mutex coordinates whole operations across companion servers in the same user/session. Contenders wait up to five seconds and respect cancellation; worker termination releases ownership. This does not coordinate the human or other automation apps. Clipboard restoration still uses text equality rather than native ownership/change-counter evidence and does not preserve arbitrary formats.

## Partial batches

Batch errors retain `completed`, `stopped_step`, `failed_step_started`, and bounded diagnostics, and add `error_details` and `retry_scope: "stopped_step"`. The disposition describes only the failed step. Earlier steps remain applied. Even a safe stopped-step retry does **not** make replaying the whole batch safe.

`completed` counts successful tool steps. It does not prove that an application saved, submitted, or otherwise completed a business operation. Observe the resulting UI or document before calling `pokemon done`.

## Local verification

```powershell
npm run build
npm run test:windows:contract
npm run test:windows:identity
npm run test:windows:coordination
```

The native contract check creates its own windows outside the visible display without activating them. It verifies both sides of the 100-match boundary and the actual worker's pre-action rejection metadata. It cleans up only its own process and temporary files. Unit and MCP transport tests run with `npm test`; the broader desktop checks remain available as `npm run test:windows`.
