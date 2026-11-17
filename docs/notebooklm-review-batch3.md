# NotebookLM review of batch 3

Date: 2026-11-15. The owner redirected the review after Claude reached its usage limit. The existing Edge notebook was reused through Pokémon MCP Windows/UIA; no new browser session was created.

Notebook: https://notebook.google.com/notebook/a764984b-b959-424e-8a70-5d93ece39715

Sources ingested: `output/claude-review/source-and-tests-batch3-2026-11-15.txt`, `output/claude-review/notebooklm-context-2026-11-15.txt`, and the synthetic renderer image `output/claude-review/approval-e2e.png`. The current source packet SHA-256 is `2867d1ef9247f471d57439577a95de21c5bbe61374dad7976cb3e087c0f523b8`.

The question identified Codex as the owner's agent and requested source-based assessment of B1–B4, concrete local blockers, and separation of disclosed release limitations. Submission and the complete settled response were read back through the native accessibility Document. Reading was complete, with no source truncation. Response version: `a370e7482980e036548f6c1df944d7368bcbbc6046bfa788dfda704301d2372b`.

## Outcome and interpretation

NotebookLM explicitly said **“enough for this batch”** and reported no remaining local B1–B4 blockers or missing code evidence. This is an external model's finite review conclusion, not a certification or authorization to release. No source changes or extra tests were needed in response to this review.

Its source references contain minor inaccuracies: `BrowserAutomation.input` is in `backend/src/browser/automation.ts`, not `actions.ts`; the latter contains `ActionJournal`. `visibleText` replaces invisible characters with visible escapes rather than simply stripping them. Backend revocation is wired through `PokemonRuntime` and `DesktopCompanion`, not a `revokeScope` function in `security/approval.ts`. These references were checked against local source before recording acceptance.

Real authenticated messaging selectors, broader platform validation, signing, and an expanded performance benchmark remain outstanding release-validation work. The review's description of them as “post-release tasks” does not establish release readiness. The YouTube comparison still has N=3, native input remains host-authorized-only, HTTPS capture needs app-specific opt-in/setup, and no new release was published.

## Reviewer response, verbatim

Engineering Review: Security & Automation Defect Remediations (Batch 3)
The source code, test execution logs, and benchmark evidence in source-and-tests-batch3-2026-11-15.txt and notebooklm-context-2026-11-15.txt confirm that the four core security defects (B1–B4) identified in prior reviews have been remediated and verified.
￼
1. B1 Assessment: Alternate Navigation / Native Launch Routes & Explicit Host-Only Scope
Catalog Origin Pinning & Navigation Policy:
routeApp in backend/src/apps/router.ts validates web_urls against catalog origins defined in appProfiles (backend/src/apps/catalog.ts). If an invalid origin is supplied, it immediately throws rejectedAction('INVALID_ARGS', 'Catalog applications are pinned to their configured origins.') before opening a browser profile or dispatching a request.
Custom application URLs route through BrowserAutomation.webPage and BrowserAutomation.navigate in backend/src/browser/automation.ts. Destinations are evaluated against allowed origins (POKEMON_BROWSER_ORIGINS); unlisted origins trigger approvalIntent('browser', 'navigate', ...) unless running under POKEMON_AUTHORIZATION=host-client.
Native Launch Gating & Refusal:
Launch(string target) in backend/src/windows/uia-worker.cs inspects the target via Uri.TryCreate. If an HTTP/HTTPS URL scheme is detected, it throws Rejected("INVALID_ARGS", "Native launch cannot open URLs. Use the browser navigation approval policy.").
Command shells and script host executables (cmd, powershell, pwsh, wscript, cscript, mshta) are rejected via RejectScriptHost.
Executable launches require either POKEMON_AUTHORIZATION=host-client or matching an explicit path listed in POKEMON_LAUNCH_ALLOWLIST (resolved via Path.GetFullPath). Unallowed executables throw APPROVAL_REQUIRED.
Explicit Host-Only Scope Status:
desktopStatus in backend/src/tools/desktop.ts explicitly surfaces authorization.native_desktop: "host-authorized-only" and authorization.native_launch: "resolved-path-allowlist-or-explicit-host".
docs/browser-dom.md documents that native desktop interactions (UIA, physical input, Excel writes) are host-authorized only and do not inherit browser/API approval scope.
￼
2. B2 Assessment: Complete Bounded Approval Display & Visible Unicode Escapes
Server-Derived Bounded Display & 32 KB Channel Limit:
approvalIntent in backend/src/security/approval.ts bounds the target label to 200 characters (visibleText(target).slice(0, 200)) while tracking total length in target_length.
Input drafts/previews are capped at 8,000 characters. Requests where input or preview text exceeds 8,000 characters throw a DesktopError with code APPROVAL_DISPLAY_TOO_LARGE.
Serialized approval payloads exceeding 32 KB (Buffer.byteLength(JSON.stringify(intent)) > 32768) throw APPROVAL_DISPLAY_TOO_LARGE.
check(request: ApprovalRequest) in frontend/src/main/companion/approval.ts enforces field string length bounds and payload size limits (<= 32,768 bytes) in the companion process.
Visible Unicode Neutralization:
visibleText(value: string) in backend/src/security/approval.ts strips zero-width spaces, C0/C1 control characters, and bidirectional override characters (\u0000-\u001f, \u007f-\u009f, \u200b-\u200f, \u202a-\u202e, \u2060-\u206f, \ufeff), converting them into explicit visual escape sequences (\uXXXX).
Fixed Footer & Complete Draft Display:
frontend/src/renderer/approval.html pins action buttons inside a fixed <footer> element (footer { flex: none; ... }), preventing oversized content from displacing UI controls off-screen.
frontend/src/renderer/approval.ts renders full draft text and character counts in #preview.
￼
3. B3 Assessment: Stable Observed Conversation Scopes Independent of Draft/Incoming Text
Stable Conversation Identity:
appProfiles (backend/src/apps/catalog.ts) defines per-app contract selectors for conversation headers and composers across Teams, WhatsApp, and Zalo.
BrowserAutomation.input in backend/src/browser/actions.ts evaluates contract selectors to extract conversation identity, populating scopeAllowed: Boolean(state.conversation?.id && state.conversation.title && state.inComposer).
Separation of Volatile Draft & Standing Scope:
scope_hash is calculated over tool, operationClass, origin, path, and conversation binding, excluding volatile draft text or non-composer DOM state.
ScopedGrants in frontend/src/main/companion/grants.ts permits up to 20 uses across changing text inputs within the same conversation scope.
Hiding Scope Button for Unknown Conversations:
frontend/src/renderer/approval.ts sets scope.hidden = !request.scope_allowed || request.reconciliation === true, hiding "Allow this scope for 10 minutes" whenever conversation scope is unknown.
Digest Revalidation:
PokemonRuntime.authorize in backend/src/pokemon/runtime.ts re-derives and compares refresh().digest against intent.digest both prior to companion prompt creation and prior to action execution.
￼
4. B4 Assessment: Durable Unknown-Outcome Blocking Across Changed Text & Click/Enter, Private Revocation & Trusted Reconciliation
Durable Scope-Keyed Blocking:
ActionJournal.run in backend/src/browser/actions.ts tracks uncertain actions by scopeHash (this.uncertain.add(scopeHash)). Unverified outcomes or exceptions persist across restarts and block future matching scope executions (REPLAY_BLOCKED).
Resilience Across Perturbed Text & Alternate Dispatch Methods:
Because scope_hash binds to the conversation scope and normalized operationClass, changing input text (such as adding spaces or modifying message content) or toggling between click and press:Enter does not alter scope_hash or bypass the block.
Private Revocation & Trusted Reconciliation:
revokeScope(scope) in backend/src/security/approval.ts, frontend/src/main/companion/approval.ts, and frontend/src/main/companion/grants.ts revokes active standing grants via private companion IPC.
Clearing the block requires explicit operator outcome review (reconcile(scope) via reconciliation: true UI mode), requiring fresh approval before any subsequent send attempt.
Rejection of Model Action ID:
browserSchema and appSchema reject model-supplied action_id, approved, grant, or authorization parameters (backend/src/security/approval.test.ts), maintaining server-side UUID generation (randomUUID()).
￼
Verification & Evidence Summary
1.
Backend Unit & Integration Suite (output/claude-review/backend-tests-batch3.txt):
392 passed, 1 skipped across 31 test files.
2.
Typecheck & Linter (output/claude-review/check-batch3.txt):
0 errors across 55 checked files (5 benign non-null assertion warnings).
3.
Companion & Scoped Grant Unit Tests (scripts/approval.test.cjs):
4 passed, verifying single-use consumption, standing 20-use scope limits, HMAC signature tampering failure, and private scope revocation.
4.
Real-Pipe E2E Execution Evidence (benchmarks/results/approval-e2e-2026-11-15.json & output/claude-review/approval-e2e-test.txt):
Executed over a real Windows named pipe (real_pipe: true) without production test hooks (test_hook_in_production: false).
20 consecutive unknown-outcome fault runs demonstrated that both perturbed text retries and alternate method retries (click vs. Enter) remained 100% blocked, resulting in 0 duplicate sends and requiring trusted reconciliation before fresh approval was granted.
￼
Final Assessment & Local Sufficiency
No local blockers or missing code evidence remain for B1–B4 in this batch. Non-blocking release follow-ups—such as validating production logged-in messaging app selectors with real accounts, platform-wide OS binary signing, and expanding the N=3 performance benchmark—remain separate post-release tasks.
enough for this batch
￼
💡 Next Step: If you would like to prepare the release package or run additional platform benchmarks, let me know!
