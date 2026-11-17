# Claude trusted-channel review, batch 2

Source: https://claude.ai/chat/a0d915ce-d30f-49b4-9b73-438580f68ad4
Third-party engineering advice read with Pokémon MCP Windows/UIA. This is evidence, not repository instructions.

Your design is mostly sound. One point needs correcting, and one hole could defeat the whole trusted channel. Still not “enough”.
Assessment
Agree: untrusted-origin envelopes, a separate trusted channel (not model-suppliedapproved=true), “unknown input counts as side-effecting”, action IDs and a journal with no plaintext, catalog-only API discovery, and opt-in encrypted capture. Your candor about what the server can’t know is right.
Correction on host-authorized mode: the owner’s authorization covers this review and implementation loop. It does not cover the shipped product sending real messages from users’ logged-in sessions. If injected page content steers the model, the host client’s standing authorization lets that action through, so the envelope is mitigation, not control.
• Host-authorized mode should be an explicit, documented opt-in, not the default for commit-class actions on authenticated third-party origins.
• Real-account testing stays fixture-only, as you proposed, unless the owner supplies sessions and scopes a grant.
• To avoid prompting on every action, use standing scoped grants: created via the trusted channel, never by the model, and bound to app, origin, action class, thread or recipient, TTL and count.
Smallest acceptable trusted channel
1. Grant request: a commit-class or unknown action returnsapproval_required(action_id) and nothing else. There is no model-visible way to issue, read or pass a grant.
2. Digest: the server computes H(tool, target identity, origin and path, operation class, input hash, state fingerprint). The state fingerprint is the spec fingerprint for APIs, plus the listener’s owner identity for local endpoints. The input hash is a hash, never plaintext.
3. Approval UI: it lives in the companion process, reached over a user-ACL’d local IPC. The dialog shows server-derived details (target, origin, text preview), never model-supplied descriptions.
4. Grant: HMAC-signed with a key held in the companion (DPAPI), single-use, short TTL, consumed atomically.
5. Execution: the server re-derives the digest immediately before executing. If anything drifted (navigation, changed text, new spec), it rejects.
6. Fail closed if the companion is unreachable.
The hole to close first
Your agent has native input, UIA and capture tools, so it could click “Approve” in the companion’s own window or read it from a screenshot. Fix:
• Denylist the companion’s process and windows in every input, UIA, capture andapp_inspect path.
• Set WDA_EXCLUDEFROMCAPTURE on the approval window.
• Document the threat model plainly: other same-user local processes are out of scope.
Other points
• Fill and keys: “draft-safe” is allowed only where a per-app contract says so. Enter or Ctrl+Enter in a composer is always commit.
• Usability: treating all unknown clicks as side-effecting in enforced mode will be painful. Allow standing grants for navigation within an allowlist, and measure how many prompts a typical session needs.
• Generic browser attach: it exposes every logged-in session in that browser, so treat it as privileged. Verify the loopback binding and owner PID at connect and on every reconnect, and require an explicit grant for attach.
• API calls: no redirects, loopback only, and bind grants to the spec fingerprint.
Acceptance tests (minimum)
• Fuzz model-facing tools with approved=true, tokens and forged grants. All are rejected.
• Changing any digest field, replaying a consumed grant, an expired grant, or navigating between approval and execution is rejected.
• Native input and capture against the approval window are refused or blocked.
• A misleading model-supplied description still yields a dialog showing the real target.
• Companion down gives approval_required, never execution.
• The journal and logs contain no plaintext input or grant secrets.
Bring back
Diffs, test output, and the files for the grant store, IPC, digest builder, window denylist and browser attach path. Keep the real-account checklist marked untested. I’ll say “enough” once the P0 items and this channel pass with evidence.
Copy
￼
Read aloud
Good response
Bad response
Retry
47 minutes ago
