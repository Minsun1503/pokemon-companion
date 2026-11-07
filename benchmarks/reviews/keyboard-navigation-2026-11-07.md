# Keyboard navigation and Custom Instructions report

Branch `perf`. Addendum `0cd59e8` and all earlier changes retained. Foreground guard and shortcut guidance committed in `eb6424a`. No push or dependencies. The existing lockfile edit was preserved.

## Result and decision

Keep the existing computer key capability, direct-shortcut guidance, and optional foreground guard. Do not add a key step to Windows batches: neither shortcut path passed the required 20/20 verification gate.

| App/path | Verified | MCP calls | Server median/p95 ms | Client median/p95 ms | Foreground mismatches |
| --- | --- | --- | --- | --- | --- |
| Edge UIA | 20/20 | 1 | 334.289 / 365.857 | 335.516 / 367.451 | 0 |
| Edge shortcut | 19/20 | 4 | 551.201 / 716.884 | 556.160 / 722.093 | 0 |
| ChatGPT UIA | 14/20 | 1 | 1051.923 / 1204.258 | 1053.476 / 1205.581 | 0 |
| ChatGPT shortcut | 11/20 | 2 | 684.519 / 883.293 | 687.727 / 885.523 | 0 |

Both comparisons alternated 20 pairs with companion on. Preparation and UIA-verified restoration are excluded from timing. Timings include failed verification samples and do not establish a reliable speed improvement. There is no screenshot or layout switching inside either comparison.

Edge shortcut run 1 produced `.1270.0.1/1234567890` instead of `127.0.0.1/1234567890` under Vietnamese Telex. Every run restored the original address with Escape twice, without Enter or navigation.

ChatGPT failures were native `COMException (0x80040201)` while controls disappeared during navigation. This means verification failed; it does not prove the shortcut failed to open Settings. Ctrl+, is supported: the menu exposed `Settings Ctrl+,`, and actual probes opened Settings. Partial samples and errors were retained, and the first two completed pairs were resumed without deleting their failed sample. Restoration allowed one read-only recovery per disappearing-control error, nine times. No input was replayed. UIA can lag behind the visible view, so these observations do not satisfy the correctness gate.

## Final source diff after eb6424a

Four production/test files: 31 insertions, 5 deletions.

- `backend/src/windows/uia-worker.cs`: get_windows.active and activate recognize the root owner of Chromium foreground child windows. The activation error now recommends a known control through windows focus instead of blind Alt+Tab.
- `backend/src/windows/automation.ts`: empty native errors and missing/null/array results reject before UI processing; no undefined result or input replay.
- `backend/src/windows/uia-worker.ps1`: when the native error message is empty, retain its exception/HRESULT diagnostic.
- `backend/src/windows/automation.test.ts`: four regressions for empty/malformed replies, zero replay, and a subsequent fresh read.

The experiment script and raw JSON evidence are included. No batch keyboard API was added.

## Validation

- npm run build: passed.
- npm run check: passed.
- npm run test: 117 backend tests passed, one existing skip; chat test passed.
- npm run test:windows: all three scripts passed. Includes clipping at 160/161 characters, full read_text, password hiding, Unicode, stale IDs, batch references, launch/wait behavior, and native input guard.
- Native guard: 40 mismatches sent zero events anywhere; 40 matches delivered exactly 20 F8 presses and 20 typed digits to A, none to B, with key releases verified.
- Latest guard internal span: 6.776 ms median / 8.929 ms p95, 80 samples. Full get_windows calls: 70.313 / 97.960 ms, 83 samples. Different scopes; guard span is not total action latency.
- git diff --check: passed.

## Custom Instructions: original and final, unchanged

The current desktop Personalization section exposed one instruction field, `Codex instructions`, backed by the selected machine's AGENTS.md. It already contained the exact requested block. No save or edit was needed; Save was disabled. Closing and reopening the editor returned the same 525 characters:

```text
You have a computer-control MCP server (pokemon-computer-use: windows, computer, pokemon). Treat it as your own capability, including during coding tasks. Before asking me to do any step on my computer (open a page, sign in, type a device code, install something), check whether you can do it with those tools and do it yourself. Ask me only for passwords, 2FA codes you can't see, CAPTCHAs, and the final Authorize/Confirm click: get the screen to the state where one click remains, tell me what to click, wait, then verify.
```

Exact tool sequence through the repository's local Pokémon MCP SDK session:

1. pokemon task: Checking ChatGPT Custom Instructions; pokemon status returned paused=false.
2. windows get_windows(query=ChatGPT), window 131198; active was true under the root-owner rule.
3. windows batch: get_ui Open profile menu Button; expand; wait_for Settings Ctrl+, MenuItem; invoke; wait_for Search settings Edit.
4. windows get_ui(query=Personal), invoke the exposed Personalization Button. The first Edit read showed the preceding view; a fresh get_ui exposed Personalization controls.
5. invoke Edit Codex custom instructions. get_ui(Edit) showed Codex instructions with value_clipped=true even though truncated=false.
6. read_text(max_chars=16000) returned the complete block.
7. Fresh Cancel lookup/invoke; wait_for Edit Codex custom instructions; invoke; wait_for Codex instructions Edit; read_text. Exact comparison matched all 525 characters.
8. Cancel without modifying text; fresh Back lookup/invoke. The next read still showed Settings. pokemon done was called after the instruction read-back matched.
9. The comparison preparation stopped because its initial UI read still showed Settings. A second Back invocation from a fresh lookup, two rereads, activate, then focus Back + guarded Return still yielded old UI readings.
10. One computer get_screenshot was used only after API and keyboard attempts could not resolve the view. It showed the conversation, and the next get_ui agreed that Settings was absent. Screenshot size was 1464 x 823. No coordinate click was used.

The installed Pokémon connector reported desktop disconnected. The existing repository SDK session exposed and executed windows/computer/pokemon successfully. All controls needed for instructions were exposed by UI Automation; no user clicks, typing, passwords, CAPTCHA, or security confirmation was needed.

## Hashes

- dist/main.js: `71DC1E3F724BD87AC4A44E86A9B17C445EC8048EA605173921461F7429B0710B`
- dist/tools/computer.js: `E5D1A270A5171336A4524DA4B30B0FF0FAC62FB1B94A437D64432341B54EF500`
- dist/windows/automation.js: `7EBB17E43E64702AE66DFA50D484A852BD1332C60CBA00D106231C2FFE11D7BB`
- dist/windows/uia-worker.dll: `EC6CF40A3ED0E48BEF53F3F2BB87A8566C24674986DB9C4EFCD82D21A3A7B004`
- Preserved backend/package-lock.json: `F0AAC8D794AE5458A52A23F93058AE27F182875C6D47A163619C19AAEF3461EA`

An unchanged main.js hash does not imply unchanged behavior: it imports the changed modules.

Skipped: batch key steps, broad benchmarks, another input/layout campaign, dependencies, and push.
Risks: focus can change between the guard and input; Telex can transform typed text; native UIA reads can fail or lag during navigation. Prefer supported field APIs and verify results.

