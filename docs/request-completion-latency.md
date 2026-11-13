# Request-to-completion latency

The November 13 PR form task took 455.097 seconds from its first recorded timer to independent full readback. The two field-writing batches took 1.422 seconds, while recorded calls in the filling/final-verification runners totaled 7.669 seconds. Those calls exclude intervening diagnostics. Most elapsed time occurred during preparation, incompatible SDK imports, recovery after an immediate stale read, and agent/tool/context gaps. Neither the server benchmark nor the local workflow-ranker benchmark measured those gaps.

## Changes

- Windows `read_text(expect_text)` waits for exact, full, live text on the original verified control. A delayed UI update stays in the same bounded read-only wait. It never repeats an input, and rejects clipped text, changed identity, pause and cancellation.
- Agent instructions and the packaged guide prefer the connected MCP tools, one known action/verification segment per batch, and session reuse. A simple form should not require generating a task-specific script or importing the SDK into a restricted runtime.
- The source fallback `scripts/desktop-client.mjs` implements a reviewed form template. It checks the expected URL and every field's previous text before the first write, then writes and fully verifies each field in one exclusive Windows batch. All discovery is fresh. No submit button is invoked. The session and native worker remain connected between requests, and learning status is checked once per session.
- Task attribution uses the returned `task_id`. Oversized values are omitted from learning parameters rather than exceeding their 1,000-character cap. Outcomes remain separate from user satisfaction; the client never creates feedback ratings.
- Each structured request records connection/queue cost, first-tool start, every call's duration and client gap, verified completion, and failure evidence. A missing form or failed check is a failed sample, never a fast success.

## Source fallback

Prefer the host's directly connected MCP tools. When those bindings are unavailable, use the shipped source client in ordinary Node:

```powershell
npm run desktop:client -- --request form.json --report timing.json
```

```json
{
  "kind": "fill_form",
  "query": "Fill the title and description and leave the form unsubmitted",
  "window_query": "Unique form window title",
  "url": "https://example.org/form",
  "fields": [
    {"query": "Title", "text": "Current title", "expected_before": ""},
    {"query": "Description", "text": "Current complete description", "expected_before": ""}
  ],
  "timeout_ms": 5000
}
```

Use current observed selectors and values; a saved example is not target evidence or authorization. Supply 1–3 uniquely identified Edit controls. `expected_before` defaults to an empty string, preventing accidental overwrite. For an existing field, supply its full freshly observed value. Prechecks are sequential observations, not an atomic version check against changes by a human or another automation client. Later failure can leave earlier writes applied; inspect before continuing and do not replay a batch blindly.

Without `--request`, the CLI accepts one JSON request per stdin line and retains the same connection until EOF. A request file can also contain an array of explicitly scheduled requests. Requests are serialized. The CLI records unsuccessful outcomes, exits nonzero if any request fails, and closes its owned MCP connection on completion. Ordinary use keeps the configured learning profile; benchmark runs should select a disposable profile explicitly. Form templates are predefined code, not generated code or unrestricted automatic replay of a learned suggestion.

If long text scrolls earlier fields out of view, supply an optional `scroll` object such as `{"query":"RootWebArea","direction":"up","count":2}` using a currently observed uniquely identified control supporting native scrolling. The client checks the URL first, then scrolls that control before field prechecks. Count is bounded to 1–3 and the entire plan must still fit 16 steps. Field discovery uses a bounded presence wait for delayed rendering. No guessed coordinates or blind keyboard navigation are used. Scroll delivery is included in partial-batch evidence; it does not make replaying a stopped batch safe.

## Timing boundaries

`request_to_verified_ms` begins when `DesktopClient.fillForm` accepts the structured request. It includes validation, queueing, a cold MCP connection/native-worker startup, learning setup and verification polling. `request_to_finished_ms` additionally includes learning finish and Pokémon completion. Warm samples reuse the first sample's connection and session capability check. First-tool timing can refer to learning setup, not the first mutating input. Per-call client gaps include JavaScript orchestration and transport; they are not pure model inference.

This boundary excludes Node/module startup, generating or reading the request file, tab preparation, and the external agent's reasoning/content composition. It does **not** replace a natural-language-request benchmark. Compare cold and warm samples separately, retain failures, and use an outer agent/client timer for request intake through verified outcome. Do not compare these samples directly with the earlier 455-second task as an isolated backend speedup.

The original PR was merged while these changes were developed. A replay on its missing form was retained as a failure before any input was sent. Actual GitHub and native-worker validation results are recorded alongside these changes.

The [actual GitHub report](../benchmarks/results/request-completion-form-2026-11-13.md) records three successful final samples: 5.71 seconds cold and 1.83/1.82 seconds with connection reuse. A subsequent cold review-description update took 5.83 seconds. These include structured-client setup and full verification; their boundary still excludes external-agent reasoning and page/content preparation. Both initial missing-form failures and incomplete development runs are retained in the raw report.
