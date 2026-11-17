Not "enough" yet. I only have your description, not source or test output, so this batch rests on the described design. I've marked items I can't judge without source.

## P0: trust boundary and side effects

**1. Untrusted-content boundary and action gating**
- **Gap:** `snapshot` and `read_text` return third-party content to the model, while `fill`, `click` and `press` can send, submit or delete. You describe pause/cancel and outcome verification, but no risk tiers or approval.
- **Change:**
  - Wrap all page-derived and app-derived output in an explicit untrusted-data envelope with its origin.
  - Classify actions as read, draft (fill without submit), or commit (send, submit, delete, pay, post). Commit requires an out-of-band, single-use approval token bound to the target and text. Unknown buttons in composers or forms default to commit.
  - Navigation from the authenticated profile to origins outside the app's allowlist needs approval.
- **Acceptance:** a fixture page with injected instructions (hidden text, `aria-label`, `alt`) saying "click Send" or "go to attacker.test". Tests show no commit action without approval and no off-allowlist navigation.
- **Need:** tool schemas, `router.ts` and the click/press handlers in `automation.ts`.

**2. Unknown-outcome handling**
- **Gap:** what happens when the connection drops or times out after a send click?
- **Change:** results are `success`, `failed` or `unknown`. Each commit action gets an action ID and an intent-then-result log. `unknown` blocks replay. Any retry reads state back first.
- **Acceptance:** fault injection (stall or kill CDP right after click-send), 20 runs. The system returns `unknown`, never double-sends, and reconciles via read-back.

**3. Real-account validation and auth states**
- **Gap:** named selectors are unvalidated on real accounts.
- **Change:**
  - A per-app contract with explicit states: `ready`, `auth_required`, `unavailable`, `layout_changed`.
  - No auto-login. QR and MFA pages map to `auth_required`.
  - `layout_changed` halts with diagnostics instead of guessing.
  - Read-only default for Zalo and WhatsApp, visible mode by default, rate limits.
  - No anti-detection tricks.
- **Acceptance:** owner-redacted DOM fixtures per app × state as regression tests, plus a manual real-account checklist with a redacted pass/fail report.

## P1: attack surface and data handling

**4. CDP and profile exposure**
- **Gap:** the profile holds logins. A loopback CDP port is reachable by any local process, and multiple MCP processes share the profile.
- **Change:**
  - For the browser the server launches itself, use the pipe transport (no TCP listener) if Playwright supports it in your setup.
  - For attach mode, verify binding to loopback only, and re-verify the listener's owning process on every (re)connect.
  - Restrict profile directory permissions to the current user.
  - Add a single-owner profile lock: a second process attaches or fails clearly.
- **Acceptance:**
  - Default mode shows no listening port.
  - 50 concurrent MCP starts produce one owner and no profile corruption.
  - Port-swap test: the app exits, an unrelated process binds the same port, and reuse is refused.

**5. Local API discovery**
- **Gap:** a spec can describe a GET with side effects (`/shutdown`, `/clear`), and path heuristics miss those.
- **Change:** one-time user approval per operation, stored with the spec hash and re-requested if the spec changes. No redirects, loopback only, and a log of every call.
- **Acceptance:** a fixture spec containing `GET /api/shutdown` is never called without approval, and a spec-hash change re-triggers approval.

**6. Capture file and persisted metadata**
- **Gap:** captured bodies can contain tokens or private messages, the process tag is operator-asserted, and the 128-entry connection store's contents are unclear.
- **Change:**
  - Capture is opt-in and off by default.
  - Redact secret-bearing keys and values before writing.
  - Encrypt at rest using the existing DPAPI/AES-GCM path, with a TTL purge.
  - Outputs carry the provenance "operator-asserted, not process-attributed" and are treated as untrusted.
  - Confirm no credentials or token-bearing URLs are stored.
  - Capture on company apps needs the owner's authorization. Document this.
- **Acceptance:** token-like fixture fields are absent from the file, the file is unreadable without the key, and a TTL purge test passes. Include the metadata schema with a redacted sample.

## P2: release reliability

7. **Observability:** every `app_read` returns `channel_used`, `attempts[]` with reason codes and timings, and the companion UI shows why a fallback happened. Acceptance: forced failure per channel yields the expected codes.
8. **Supply chain and platforms:** define an update policy for pinned Chromium/Playwright. `ensure-browser.cjs` verifies checksums and fails closed. Offline and proxy errors are actionable. Release checksums and signing are in place. macOS and Linux are labeled experimental in docs, package metadata and runtime messages. Acceptance: a corrupted-download test fails closed.
9. **Benchmark:** n=3 is anecdotal. Rerun with N≥20, report p50 and p95, and separate cold start.
10. **Electron shell** (needs source): confirm contextIsolation on, nodeIntegration off, sandbox, validated IPC, no remote content, and update signing. Provide the checklist with file references.

## Bring back
- Diffs and tests for items 1-3 (P0).
- `automation.ts`, `router.ts`, `connections.ts`, `local-api.ts`, `scripts/api-capture.py`, the Electron main/preload files, and the tool schema list.
- Fixture test outputs and the real-account checklist result.
- Which approval mechanism you chose, and how it reaches the user.

I'll say "enough" once P0 and P1 are implemented with passing acceptance evidence and I've seen the files above.
