# Final reliability report and frozen build

Branch `perf`. Final code diff against `db840f0`: 10 files, 141 insertions and 11 deletions. Earlier Custom Instructions/addendum commit `0cd59e8`, safety fixes `0fbbf82`, and retained screenshot resize `fc3cdf9` remain intact. No push or new dependencies. The unrelated `backend/package-lock.json` edit was not staged or modified; SHA-256 `F0AAC8D794AE5458A52A23F93058AE27F182875C6D47A163619C19AAEF3461EA`.

## Final changes

1. `uia-worker.cs`: activation failure recommends one retry, background UI Automation, or Alt+Tab for caption-only UI. It no longer tells the model to ask the user to select the window.
2. `batch.ts`: URL launch records the pre-launch window inventory, polls broad discovery, and reports up to five new/changed titles/processes if its query times out. It explicitly distinguishes successful launch from the unmatched query. Truncated broad inventory falls back to the original filtered lookup. The tool description recommends querying by browser process. Two tests cover diagnostics and truncated-list fallback.
3. `uia-worker.cs`: field `read_text` prefers the live ValuePattern, preserving empty strings, whitespace, and literal U+FFFC. ValuePattern controls expose `read_text`. Document controls retain TextPattern body text. Fields are bounded at 8000 characters with a truncation flag. Native smoke covers empty single-line input, two spaces, literal U+FFFC, long values, and document body text. The earlier blank ChatGPT Settings field reproduced the object marker; the disposable native fixture verifies the corrected behavior.
4. `computer.ts`, `uia-worker.cs/ps1`: `type` warns that Vietnamese/IME layouts can alter letters, recommends `windows set_value`, and returns verification guidance. A read-only observation reports foreground `keyboard_layout`, `language_id`, and `imm_ime`, with a 200 ms cap and unavailable fallback. Pause/cancellation is rechecked before any input. Three tests cover pause, cancellation, and metadata failure. No automatic layout switching was added to the server. This observation does not detect every external/TSF IME mode.

Pause/cancellation, exclusive execution, password hiding, stale-ID rejection, no input replay, calibrated mouse delays, and Unicode/clipboard behavior remain intact.

## Verification

- `npm run build`: passed.
- `npm run check`: passed after fixing template-literal unknown types and test formatting.
- `npm test`: 104 passed, one existing skip; companion chat passed.
- `npm run test:windows`: both native scripts passed. Password hiding, exact field values, 160/161-character clipping flags, long read-back, document body text, atomic/batch compatibility, bounded responses/timeouts, shell rejection, launch paths, and disposable browser URL verification passed. The existing suite prints its embedded 20-sample timing checks; no separate benchmark command or performance experiment was run.
- `npm run test:input`: initially failed under Microsoft Vietnamese Telex, shortening/altering its existing 500-character alphabetic string. The unchanged assertion passed after manually selecting the already-installed English (US International) layout for the controlled test. Unicode/Vietnamese paste, shortcuts, click, and real input-method metadata assertions also passed. Original Vietnamese layout was restored and verified as `keyboard_layout: 0409042A`, `language_id: 042A`, `imm_ime: true`.
- `git diff --check`: passed.

English layout observation: `keyboard_layout: F0010409`, `language_id: 0409`, `imm_ime: true`. This reinforces that the metadata is a layout observation rather than a guarantee that typed text will be exact.

## Built artifact

`backend/dist/main.js` SHA-256:

```text
71DC1E3F724BD87AC4A44E86A9B17C445EC8048EA605173921461F7429B0710B
```

No further builds or source changes after this successful validation. This is the requested entry-file hash, not a manifest hash of every imported runtime file.

## Tool behavior and limits

Installed Pokémon connector still reports desktop disconnected. The existing local SDK session against the repository's MCP server handled desktop work. User pause state was checked and reported false before native testing. UI Automation read the Claude composer; `set_value` and `read_text` support safe report delivery. The input-language popup exposed no controls through `windows get_ui`, including a reread. Keyboard Win+Space switched between the two installed layouts; screenshots were needed to identify English US International versus Vietnamese Telex. One coordinate click opened the hidden-icons popup and another opened Quick Settings; both were dismissed without changing settings. The original input layout was restored.

Earlier measured screenshot gains and the rejected capture-exclusion experiment remain in `claude-followup-2026-11-07.md`. Existing hide/show and 120 ms wait remain. PNG pixels can differ slightly and fixed-input bytes can increase. GitHub signed-out/new-chat product acceptance testing remains unrun because it requires clearing existing authentication, deleting a remote test repository, and restarting the live ChatGPT app. No claim of globally impossible further optimization is warranted.
