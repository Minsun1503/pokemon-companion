# Course navigation and reading API

The `course` MCP tool is available on Windows to Claude, Codex, and other local MCP clients. It combines control discovery, one input action, polling, and text reading. This reduces exchanges with the model; the native Windows calls still run individually. There is no site-specific selector configuration, screenshot capture, or automatic input retry.

Build the backend with `npm run build`, then reconnect the MCP server. The existing `windows` and `computer` tools remain available for discovery, scrolling, and fallback actions.

## Identify targets once

Use `windows get_windows` to choose a window. Activate it if Chromium exposes only title-bar controls, then use `windows get_ui` to inspect its `Document`, `Button`, `TabItem`, and `Edit` names. Copy the exact observed names into course requests; example names below are placeholders. A browser's address bar and the course's Search field are different controls.

Every request requires `window_id` and `document_name`. Matching is exact and case-sensitive. Duplicate exact names or truncated discovery stop the action. Only visible controls are discoverable: scroll with `windows` first when necessary. The Document must expose the UI Automation Text pattern. Use a narrow inner Document where available, especially if a larger document includes changing timers or unrelated content.

## Actions

| Action | Additional inputs | Result |
| --- | --- | --- |
| `read_lesson` | `offset`, `page_chars`, `version` | Versioned accessible text page |
| `open_lesson` | `navigation_name`, `navigation_role`, `ready_text`, `page_chars` | Invoke/select once, wait for new lesson text, return first page |
| `search_courses` | `search_name`, `search_text`, `ready_text`, `page_chars` | Set one field, verify its actual value, wait for result text, return first page |
| `check_completion` | `completion_text` | Specific message count, excerpt, and evidence status |

```json
{"action":"open_lesson","window_id":"12345","document_name":"Training","navigation_name":"Next lesson","ready_text":"Chapter two: customer orders"}
```

`navigation_role` defaults to `Button`; `TabItem` uses the control's select pattern. Navigation waits for a changed document version and exactly one occurrence of `ready_text`. If the named destination Document did not exist before navigation, its appearance with the marker is sufficient. Choose text unique to the requested lesson, not a navigation label shared across lessons.

```json
{"action":"search_courses","window_id":"12345","document_name":"Training","search_name":"Search","search_text":"Newcomer 08","ready_text":"Newcomer 08 - Product images"}
```

Search requires a field supporting the set-value pattern and an application that updates results when the field changes. It does not submit an Enter key or press a separate Search button. It verifies the field's actual value, then requires changed document text and exactly one result marker. An already matching field is not rewritten; its current results must still contain the marker. Choose a result-specific marker, not merely the echoed query.

```json
{"action":"check_completion","window_id":"12345","document_name":"Newcomer 08","completion_text":"Completed lessons: 3/3"}
```

Completion status is `confirmed` for one exact occurrence, `not_found` for none, `ambiguous` for multiple, and `unknown` when source text is capped. The caller must identify a message belonging to the selected course. Matching that text does not establish that all material was read, that the account's server-side progress is current, or that a quiz was passed. Absence does not prove the course is incomplete. This helper performs no input.

## Read every text page

```json
{"action":"read_lesson","window_id":"12345","document_name":"Training","offset":0,"page_chars":6000,"max_chars":8000}
```

Successful reading results contain `text`, `offset`, `next_offset`, `has_more`, `total_characters`, `source_truncated`, and a SHA256 `version`. `open_lesson` and `search_courses` return the same page fields plus `readiness_verified`. Offsets and lengths count UTF-16 code units, matching JavaScript string length. Page boundaries preserve surrogate pairs such as emoji.

Continue with the **returned** cursor and the first page's version:

```js
async function readAllLessonText(client, windowId, documentName) {
  let offset = 0;
  let version;
  let text = '';
  for (;;) {
    const response = await client.callTool({
      name: 'course',
      arguments: {
        action: 'read_lesson', window_id: windowId,
        document_name: documentName, offset, version,
        page_chars: 6000, max_chars: 8000,
      },
    });
    const page = JSON.parse(response.content.find(c => c.type === 'text').text);
    if (response.isError || !page.ok) throw new Error(page.error);
    if (page.source_truncated) throw new Error('Read the source file or a narrower Document.');
    version ??= page.version;
    text += page.text;
    if (!page.has_more) return text;
    if (page.next_offset <= offset) throw new Error('Reading made no progress.');
    offset = page.next_offset;
  }
}
```

Later pages require the original `version`. A changed document fails; restart at offset 0 after inspecting the UI. Never combine pages from different versions. Quotes and line breaks increase JSON size, so `max_chars` may shorten a text page. `response_truncated: true` identifies that shortening, and `next_offset` always follows the text actually transmitted. Do not calculate the next cursor using `page_chars`. Reading to the last accessible page does not inspect downloads, images, videos, canvas content, or closed lesson sections.

## Bounds and failures

- `timeout_ms`: default 5,000, maximum 15,000. The execution deadline starts after acquiring the shared action queue and bounds native requests and polling; time spent queued and companion feedback can add latency.
- `page_chars`: default 6,000, range 100–12,000. `max_chars`: default 8,000, range 1,000–16,000, including serialized JSON metadata.
- Native reading retains at most 1,000,000 UTF-16 code units. `source_truncated: true` explicitly marks an incomplete source. Navigation/search readiness cannot be confirmed for a capped Document; completion checks return `unknown`.
- These bounds concern text returned by the application's accessibility provider. A provider may omit or shorten content itself without exposing a truncation flag (Chromium can shorten very long individual text runs). `total_characters` counts the returned accessible text, and `source_truncated: false` only means our own cap was not reached. Use source files when complete content coverage matters.
- Exact accessible names are single-line strings of 1–160 characters. Markers are at most 200 characters; `completion_text` must be at least 12 characters to discourage generic labels.
- A whole course operation is exclusive with other actions sharing the runtime. User pauses and MCP cancellation stop further work.
- Failures include `phase`, `native_calls`, and `input_state`: `not_sent`, `applied`, or `unknown`. `applied` means the native input request succeeded, not that its application effect was verified. `unknown` means the request started but failed or was interrupted. Inspect the current UI before continuing; inputs are never replayed automatically.

For programmatic integration, `backend/dist/index.js` exports `runCourse(runtime, request, signal?)`, `courseSchema`, and the `CourseRequest` type. Reuse your existing `PokemonRuntime` and close it when finished. `runCourse` returns the same compact MCP result; invalid requests throw before desktop access. There are no quiz-answering or automatic Finish actions in this API.

## Verification

After building, run `npm run test:course` on an unlocked Windows desktop. It opens and closes a uniquely named local browser fixture, exercises real Windows APIs through an MCP client, reconstructs long text beyond 8,000 characters, checks emoji boundaries, delayed navigation, duplicate rejection, stale versions, completion messages, and verified/idempotent search. It uses no screenshots or live training account. Backend unit tests cover output budgets, cancellation, pauses, ambiguous targets, capped sources, input uncertainty, and isolation between clients.
