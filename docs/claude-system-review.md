# Claude system review

Status: the finite B1–B4 review is complete. Claude reached its usage limit after the batch 3 fixes were returned; on 2026-11-15 the owner redirected the review to the already-open NotebookLM notebook. The current source packet, prior criteria/consolidated E2E context, and synthetic approval capture were uploaded using Pokémon MCP Windows/UIA. NotebookLM's complete settled response explicitly said “enough for this batch” and reported no remaining local B1–B4 blockers. The response and source-reference corrections are preserved in `notebooklm-review-batch3.md`. Earlier Claude advice is preserved in `claude-review-batch1.md`, `claude-review-batch2.md`, and `claude-review-batch3.md`. This model review does not establish release readiness; existing release-validation limitations remain outstanding.

The owner requested an iterative review with Claude: describe the current system, implement its applicable recommendations, verify them, and continue until Claude explicitly says the review is sufficient. Only the system description and technical review material are to be shared; private application contents are excluded.

Current verification: the backend suite passed 369 tests with 1 skipped on 2026-11-15. The local Windows MCPB and ZIP have SHA-256 `69e2906dcd3cf4a5fdf6b227c380dd651a2569ea4faa90ec7bfa03b186f6f71b`. The package extraction/browser checks passed in the preceding implementation turn. Its source and default Chromium paths have been inspected again for this review.

## Review scope

- TypeScript MCP server and Electron companion.
- Bundled Chromium with Playwright DOM reading/actions and persistent per-user browser profiles.
- Web-first application routing, followed by desktop CDP, local OpenAPI or configured proxy capture, Win32, UIA and selected-window capture.
- App-owned endpoint discovery, guarded identities, persisted connections, rediscovery and bounded observation.
- Optional Python/mitmproxy interception requiring app-specific setup; universal automatic HTTPS interception is not implemented.
- Packaging, source setup and actual runtime/tool-description consistency.
- Validation coverage and production-app limits, including the small local YouTube comparison.

## Review record

Claude review conversation: https://claude.ai/chat/a0d915ce-d30f-49b4-9b73-438580f68ad4. The initially created review chat was the wrong selection and is no longer used. Do not infer review completion from delivery.

## Prepared message

I am Codex, an AI agent acting on behalf of the owner of pokemon-companion. The owner asked me to explain our current system, implement your recommendations, then return for review until you explicitly say "enough". Please review the engineering and give a finite, prioritized batch of concrete changes. I will inspect the actual source, implement applicable local changes, run meaningful checks and bring you the results. Focus on the adapter and making the existing product reliable for users.

Current system:
- TypeScript/Node MCP server plus an Electron animated desktop companion. Windows is the verified desktop-control platform. macOS/Linux packages exist, but their full native desktop workflows have not been validated as thoroughly.
- Web interactions use Playwright DOM tools. browser supports launch/connect/tabs/navigate/snapshot/read_text/fill/click/press plus bounded response metadata capture. No arbitrary script-evaluation tool is exposed.
- Chromium is now installed automatically by source setup and bundled in release packages. It is matched to the locked Playwright 1.65.1 dependency (Chromium 159.0.8154.6, revision 1255). The executable resolves relative to the backend after relocation, rather than a global browser cache. The full browser supports visible and headless operation. Each user's dedicated persistent profile retains website login; users authenticate themselves.
- The app read router tries an app's web URL first (Teams/WhatsApp/Zalo or custom URLs and ready/unavailable selectors), then a selected desktop app. browser and app read now default to bundled Chromium. Existing ordinary Edge profiles cannot reliably expose CDP, which is why we added the dedicated bundled browser.
- app_inspect reads a Windows app by guarded window_id/window_ref. Native metadata discovers local listeners belonging to that window's process family, including child processes. The fallback order is CDP/DOM, API, Win32 child-window text, UIA, then selected-window capture. Ambiguous pages/targets and stale identities stop rather than guessing.
- CDP uses loopback endpoints and Playwright. Closing an attached CDP connection disconnects without killing the desktop app.
- API discovery probes local /openapi.json, /swagger.json and /swagger/v1/swagger.json on app-owned listeners. It supports described public GET operations without required parameters, excludes declared authentication and obvious mutation paths, and bounds timeouts and response size. Multiple operations return a catalog for selection.
- Verified connection metadata is persisted (up to 128 app/executable entries). Endpoint ownership is revalidated before reuse. Failed reads, detected executable-version changes or changed required fields/top-level API response types trigger rediscovery. Inputs are not automatically replayed.
- Optional API interception is a mitmproxy Python addon, scripts/api-capture.py. It stores bounded recent text/JSON response bodies, removes URL query strings, omits request data and headers, and tags them with an operator-supplied process ID. app_inspect can read this capture file with an app/URL scope. This is NOT independent process attribution. It currently requires Python/mitmproxy and app-specific proxy setup; it is not bundled. Wireshark is not integrated. The system does not automatically install proxy certificates or alter global proxy/trust settings, and does not bypass certificate pinning.
- Windows helpers also implement guarded native input, UIA, Excel operations and screenshots. Actions honor pause/cancellation, use observed identities and refs, and require outcome verification.
- Local task learning stores encrypted bounded records (AES-256-GCM, DPAPI on Windows) and uses a small CPU-only online workflow ranker; screenshots and full app contents are excluded. No automatic uploads.

Evidence and limits:
- Current backend: build and lint passed; 369 tests passed, 1 skipped.
- Live Electron/HTTP fixture checks cover web precedence, CDP discovery, survival after disconnect, saved CDP/API reuse across MCP processes, changed-port/route rediscovery, missing-operation catalogs, native fallbacks and actual window capture.
- Bundled Chromium smoke tests verified default visible/headless DOM discovery, fill/click readback, persistent storage after relaunch, and the app router with an empty external browser cache.
- A real Windows MCPB was extracted into a new directory and launched using bundled Node with system-only PATH and an empty external browser cache. Browser DOM actions, adapter routing, native worker and all nine companions passed. Local package: about 425 MB compressed, 975 MB unpacked. It has not been republished to GitHub during this work.
- Small YouTube benchmark: 3 successful searches per method, Playwright median 6.08 s vs Windows/UIA 8.25 s, with startup measured separately. This is a limited local workflow benchmark, not universal performance.
- Named authenticated web selectors and arbitrary production desktop apps have not all been validated with real accounts. Universal zero-setup HTTPS interception is not implemented.
- Source/packaged browser defaults are new; the currently connected MCP process still exposes older tool descriptions until reloaded, although its explicit Chromium session works.

Relevant source: backend/src/browser/automation.ts and bundled.ts; backend/src/apps/router.ts, connections.ts, local-api.ts; backend/src/desktop/inspect.ts; backend/src/windows/app-probe.cs; scripts/ensure-browser.cjs; scripts/api-capture.py; docs/browser-dom.md.

Please identify the highest-priority concrete gaps and what source/evidence you need. Recommend changes within this project, with acceptance checks. I will return after implementing them. Explicitly say "enough" only when this review is sufficiently complete.

## Approval implementation evidence, 2026-11-15

The owner chose the companion approval UI with reusable scoped grants. Enforced browser/API approval is now the default, with explicit environment overrides for trusted host clients. The companion holds signed grants and a DPAPI-protected key, receives requests over a private Windows named pipe, and renders server-derived target/input details. The server revalidates the digest before dispatch. Native inspection, input and capture reject the protected companion process, including old element references.

The live test caught a startup race. The fix protects a hidden anchor before dialog creation and revalidates the dialog HWND after load/show. The regression asserts protection immediately after the approval response, with no settling delay: two protected windows, one approval window, one visible approval. No action executes without approval. A provenance addition also exposed an oversized title-bar-hint response; display titles are now bounded while identity and provenance are retained, with explicit failure for insufficient metadata budgets.

Verification: build/check pass with lint warnings; backend 389 tests pass and one is skipped; scoped grants pass three tests; native guard and live companion smokes pass; Python capture encryption/redaction/TTL passes three tests. The earlier 20-run synthetic browser fault report records unknown outcomes, blocked replay, one send on readback per run and zero duplicates. Real authenticated Teams/WhatsApp/Zalo checks remain untested, the YouTube benchmark remains N=3, and no new signed release or platform acceptance is claimed.

Uploaded source packet: `output/claude-review/source-and-tests-2026-11-15.txt`, SHA-256 `ca9af060e174a2571c1496c817daa94af08e74d9a2b76760c9d2456b119ca2c7`. It contains the source and evidence at upload time. Documentation subsequently added the explicit capture opt-in, encrypted-format/expiry details and named approval test commands.

## Source-review blockers and fixes

Claude's source review found four blockers, preserved in `claude-review-batch3.md`: alternate navigation/launch routes, incomplete approval display, unstable conversation scopes, and replay through changed input after an unknown outcome.

The fixes pin catalog origins, apply navigation policy to custom web app pages, refuse native URL launch, and require a resolved executable allowlist or explicit trusted-host mode for native executable launch. Native desktop input is explicitly documented and reported as host-authorized-only. Display fields are bounded and invisible characters escaped; complete oversized drafts are refused. Browser reusable scopes require a contract-observed conversation identifier and a target within its composer. Incoming text outside the draft is excluded from the state. Unknown outcomes block a stable scope, including changed text and switching from click to Enter; private revocation and trusted outcome review precede any new approval.

Build/check pass with lint warnings. Backend tests: 392 passed, one skipped. Four scoped-grant tests pass. The real-pipe test uses production grant/UI classes and the backend companion bridge with a separate test companion entry; no test decision hook is present in the production handler. It verifies once-only execution, 20 permitted scoped fills, expiry, two threads sharing a path, changed fills, incoming-message mutation, capped 100 KB labels, visible footer buttons, complete draft display, and oversized-input refusal. Twenty accepted-send/transport-close runs block both changed-text and Enter retries, reconcile through the trusted test companion, require a new approval, and produce zero duplicate sends.

Updated source/diffs/evidence and a synthetic renderer capture were returned to the same Claude chat. Packet: `output/claude-review/source-and-tests-batch3-2026-11-15.txt`, SHA-256 `2867d1ef9247f471d57439577a95de21c5bbe61374dad7976cb3e087c0f523b8`. After Claude reached its usage limit, the owner switched the reviewer to NotebookLM, which accepted this finite batch. Production account checks, wider platform validation, signing, and the N=3 benchmark remain release limitations.
