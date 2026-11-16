# Learn an API from a web demonstration

The `api` tool watches requests in a browser managed by Pokémon MCP. You demonstrate an action once, inspect the saved request, and explicitly ask to reuse it. While watching remains active, newly observed request shapes add catalog entries and repeated requests refresh their existing entry and revision.

Cookies stay in the browser's persistent profile. This adapter does not export cookies, inherit a login from another browser, or keep credentials alive forever. Sign in yourself in the visible browser. A fresh demonstration is required when credentials expire or the browser session changes.

## Try the capture console

From the active `.publish` checkout:

```powershell
npm --prefix backend run build
node scripts/start-mcp.cjs --check
npm run api:watch -- --url https://outlook.live.com/mail/
```

The console starts its own MCP process with `scripts/start-mcp.cjs`, a separate persistent browser profile and a separate companion data directory. Existing shared MCP/browser processes are left running. Normal companion authorization remains enforced; a trusted host's existing explicit authorization configuration is preserved. Capture startup waits up to 45 seconds for a human dialog decision within the original request. The console also enables that wait for its navigation requests with `POKEMON_APPROVAL_WAIT=on`. If the wait expires, capture stays off; check the page and start again after approving. Approval windows are excluded from automation and require a manual click. The console cannot execute saved requests.

1. Sign in yourself in the opened browser, including any password or OTP.
2. Type `watch` in the console after login. If multiple HTTP(S) tabs exist, type `tabs`, then `watch <page_id>` to select one. An optional final URL prefix narrows capture to a path on that tab's origin.
3. Perform one action, such as opening an inbox folder. Updated redacted catalog entries appear in the console.
4. Repeat the action to refresh its saved request, or click something new to add another operation. A click can generate several requests, and some requests are background activity.
5. Type `status` or `inspect <operation_id> <revision>` to inspect capture. Type `stop` to stop observing; `quit` closes the owned browser. Login cookies and the encrypted catalog persist in the profile directory for later sessions.

The default console profile is `%LOCALAPPDATA%/pokemon-companion/browser/api-demo`. Use `--profile <absolute path>` to choose another profile. Keep the console open while demonstrating.

To replay a console capture from another MCP client, first quit the console so it releases the browser and catalog locks. Configure that client's `POKEMON_API_DIR` as `<console profile>/api-catalog`, launch `browser` with the same console profile path, and discover its new page ID. The console's page IDs cannot be reused in a new process. Normal MCP capture uses `%LOCALAPPDATA%/pokemon-companion/session-api` unless `POKEMON_API_DIR` is set.

## MCP sequence

Build and reconnect your MCP client to expose `api`. Use the same connected MCP process for `browser` and `api`, since page IDs are process-local. Replace IDs and the example origin with observed values.

```json
{"action":"watch_start","page_id":"<browser page_id>","url_prefix":"https://example.com/api/"}
{"action":"watch_read","page_id":"<browser page_id>","max_chars":16000}
{"action":"inspect","page_id":"<browser page_id>","operation_id":"<catalog ID>","revision":1}
{"action":"watch_stop","page_id":"<browser page_id>"}
{"action":"review","page_id":"<browser page_id>","operation_id":"<catalog ID>","revision":1,"effect":"read"}
{"action":"execute","page_id":"<browser page_id>","operation_id":"<catalog ID>","revision":1,"query":{"folder":"archive"}}
```

Inspect before classifying the request. HTTP method alone does not identify its effect: Outlook and GraphQL can use POST for reads. Review and execution use the existing authorization mechanism. Changing saved URL, body, headers or cookies clears its reviewed effect; each observation increments the revision. Always select the current revision. Stop watching before review/replay when background requests keep refreshing the selected operation.

Only existing noncredential query parameters and top-level JSON fields may be overridden. Arbitrary URLs, headers, cookie values and new fields cannot be supplied. JSON operation/action identifiers cannot be overridden. The exact effective request is hashed into its authorization binding.

## Limits and outcomes

- Captures same-origin XHR/fetch responses on the selected page. Cross-origin APIs need a page on their own origin. WebSockets, service-worker-only requests, multipart uploads and binary payloads are unsupported. Failed requests without a response are not captured.
- Click correlation uses a three-second timing window in the main frame. It is evidence, not proof that the click caused that request; a UI workflow may require several dependent calls. The adapter does not infer a complete multi-step workflow automatically.
- Raw templates are stored encrypted locally using Windows DPAPI-protected keys. Returned previews and JSON mask credential field names and known cookie/token values. Personal message content may still be returned by a requested read. Authentication endpoints and common login payloads are excluded from capture. Unsupported or malformed payloads can appear as nonreplayable catalog entries.
- Catalog storage is capped at 128 operations and approximately 2 MiB; oldest entries are evicted. Capture queues are capped at 32 requests, with dropped/skipped counts. `max_chars` bounds catalog JSON and replay text; omitted catalog counts are explicit. Newest observations appear first. Increase the budget up to 16,000 or pass `next_offset` as the next call's `offset` to read older entries. If a row cannot fit, increase the budget; an unchanged offset indicates that row did not fit. Requests whose complete preview exceeds 8,000 characters cannot be reviewed or replayed.
- Templates default to one-day validity, configurable from one minute to seven days. Templates containing detected token/header credentials expire after at most five minutes. Expired rows may remain encrypted on disk until refreshed or evicted. All cookies for the target host contribute to session identity, so tracking-cookie rotation can also require recapture.
- Replay shares the browser cookie jar and requires the same profile, origin, cookie fingerprint and catalog revision. Server rejection with 401/403 expires the saved template. It never follows redirects or automatically retries. Playwright buffers a response before the 2 MiB accepted-content check; this is not a streaming transport limit. Non-JSON response content is withheld.
- A successful JSON read returns its HTTP status and redacted response. An HTTP success does not prove a write's final effect. Writes and transport failures remain uncertain and block additional executions of that operation across restarts, parameter changes and effect reclassification. Verify the target state first, then use `reconcile` for the companion's separate operator confirmation. Reconciliation sends no request and does not authorize the next execution.

Outlook is an example target, not a verified authenticated integration. Sites may require short-lived CSRF tokens, signatures, per-request IDs, application-specific dependencies or browser behavior that generic replay cannot reproduce. For durable Outlook automation, Microsoft Graph with OAuth is the supported long-term API.

Validation:

```powershell
npm --prefix backend test -- --run src/browser/api.test.ts
npm run test:api-session
```
