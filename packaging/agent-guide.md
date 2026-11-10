# Using the desktop tools

Start with `desktop` using `{"action":"status"}`. Check native readiness and platform limits. A ready worker does not establish permission to control every app. Native application controls are supported on Windows; screenshots and physical coordinates cover the primary display.

Use `windows` in its default batch mode: provide `steps` with 1-16 sequential atomic actions and omit the top-level `action`, or set `action:"batch"`. Plan discovery, supported UI Automation actions and verification together when those steps are known. Use an explicit individual action when the next step needs judgment. Preserve each returned `window_ref` with its `window_id`. Preserve each element's `snapshot` with its `element_id`; IDs from different snapshots cannot be mixed. A `targetable:false` control lacks a unique complete capture. Refine discovery instead of guessing.

For a dense window, use `get_ui` with `view:"skeleton"` to find a named container. Use its snapshot and element ID as `root_snapshot` and `root_element_id` on a subsequent `get_ui`. Incomplete results do not prove that other matching controls are absent. `wait_for` supports bounded presence, absence, enabled/disabled, and selected/unselected waits. Absence needs a unique control from a prior complete whole-window snapshot, with an exact stable name or automation ID.

Use Course and Excel tools for their specialized operations. Verify the resulting field, page, or saved document. A dispatched input, or `verified:false`, does not prove the task's business result. Only mark `pokemon` done after observing the intended result.

On failure, inspect `error_details.disposition`. Retry only when `retry:"safe"`, following recovery instructions. `STALE_REF` requires fresh discovery. A batch's retry disposition applies only to `stopped_step`; completed steps stay applied and must not be replayed. Inspect the app after uncertain delivery. Respect every user pause; only the user should resume it.

Use physical keyboard or mouse input when suitable native controls are unavailable. For guarded Windows key/type calls, provide the observed `window_id` and `window_ref` and verify afterward. Avoid blind Tab or Alt+Tab navigation. Foreground focus can change between a check and dispatch.

Ctrl+Shift+P pauses or resumes control. Pokémon Talk is a separate character conversation; it does not relay instructions to the desktop-control planner. These tools do not automatically retry inputs.
