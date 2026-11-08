# Server optimization follow-up

Branch perf, November 7, 2026. Earlier addendum 0cd59e8 is intact. Audit fixes: 0fbbf82. Sharp resize: fc3cdf9. No push or new dependencies; unrelated backend/package-lock.json edit untouched.

## Real apps

20 verified samples per scenario, companion on. Settings uses its blank Search settings Edit. Edge shows the public domdomegg/computer-use-mcp GitHub page and uses its Address and search bar. set_value writes the SAME existing short value and verifies it; no settings or navigation were saved. Median / p95 milliseconds:

| App | Action | ms | Scanned | Returned | Truncated runs |
|---|---|---:|---:|---:|---:|
| ChatGPT Settings | get_windows | 46.3 / 54.5 | n/a | 1 | 0/20 |
| ChatGPT Settings | get_ui_narrow | 89.0 / 92.3 | 186 | 1 | 0/20 |
| ChatGPT Settings | get_ui_wide | 90.1 / 96.4 | 186 | 91 | 0/20 |
| ChatGPT Settings | set_value_verify | 106.1 / 114.9 | 186 | 1 | 0/20 |
| ChatGPT Settings | activate | 8.0 / 11.2 | n/a | n/a | 0/20 |
| GitHub / Edge | get_windows | 47.9 / 66.2 | n/a | 1 | 0/20 |
| GitHub / Edge | get_ui_narrow | 153.9 / 164.0 | 312 | 1 | 0/20 |
| GitHub / Edge | get_ui_wide | 163.4 / 171.6 | 312 | 143 | 20/20 |
| GitHub / Edge | set_value_verify | 202.1 / 240.2 | 336 | 1 | 0/20 |
| GitHub / Edge | activate | 7.7 / 10.2 | n/a | n/a | 0/20 |

Narrow get_ui is under 250 ms on BOTH apps, so traversal was left alone. Counts above are the first sample; GitHub set/verify traversed 336 nodes after toolbar editing versus 312 initially. Raw samples preserve all counts.

perf-real-chatgpt get_ui_narrow: combined tree/property reads 82.2 ms (92.3% of client time), JSON serialization 0.023 ms.
perf-real-chatgpt get_ui_wide: combined tree/property reads 83.4 ms (92.5% of client time), JSON serialization 0.088 ms.
perf-real-github get_ui_narrow: combined tree/property reads 147.5 ms (95.8% of client time), JSON serialization 0.028 ms.
perf-real-github get_ui_wide: combined tree/property reads 155.6 ms (95.2% of client time), JSON serialization 0.292 ms.

Property reads are not separately instrumented; no invented split. Nested spans overlap; SDK framing is not isolated.

## Screenshot

Windows 11 build 26200 / Electron 42.3.3. GetWindowDisplayAffinity returned true and 17 (WDA_EXCLUDEFROMCAPTURE, 0x11). We tested the real companion renderer with a sentinel, four requested positions including center, 20 normal and 20 tray-summoned captures (backend-visible state false before summons). Positive control detected sentinel pixels; unprotected fallback hid every companion window and detected zero. Candidate capture commands kept the protected pet visible.

All 40 candidate PNGs had zero sentinel pixels. BUT the corrected SAME-screen-coordinate comparison still had one point differing from the hidden-window reference. Its cause is not established. The candidate was REVERTED per the conservative rule: existing awaited hide/show and 120 ms compositor wait remain. No production protection change survived. Candidate patch and failed/complete observations are saved.

Candidate capture_hide median fell 137.3 -> 0.4 ms, while full tool medians regressed: on 713.0 -> 842.4 ms; off 580.4 -> 648.5 ms. Resize/encode costs rose during that run. Neither full-wall gain nor complete underlying-content verification was established; unfavorable results were retained.

Retained resize: Sharp linear kernel in the raw RGBA resize/composite/PNG pipeline. Crosshair is composited AFTER resizing, preserving its exact three-pixel thickness and edge clipping. Dimensions, PNG quality 80 and compressionLevel 9 are unchanged.

20 verified tool calls per mode before/after the retained resize, with hide/show restored:

| Companion | Before median / p95 ms | After median / p95 ms | Median bytes before -> after |
|---|---:|---:|---:|
| on | 828.3 / 1287.0 | 466.1 / 556.8 | 158841.5 -> 103642.5 |
| off | 683.2 / 875.1 | 369.7 / 489.9 | 159079.5 -> 103195.5 |

Fixed raw input, alternating order, 20 samples each: old pipeline 276.1 / 319.1 ms and 99051 bytes; Sharp 186.2 / 225.0 ms and 109776 bytes. Linear had the lowest mean absolute error among five tested kernels: RGB MAE 0.381/255, RMSE 1.790, max difference 34. An earlier scene had MAE 0.604. Pixels are close, not bit-identical; fixed-input bytes INCREASED, so smaller payloads are not promised. Fixed timings include an old-path input clone and prebuilt new overlay; full tool timings include actual allocation/drawing. Live desktop content and load also vary.

## Safety audit: all four now yes

1. ASCII pause/cancel reports submitted count/total, notes input-method transformation, and instructs reading the field without restarting. computer.ts:239. Existing error prefix retained; tests assert 32 of 500 submitted and no further input.
2. wait_for/launch usage sentences, matched lower-bound wording and fresh-snapshot guidance: tools/windows.ts:16 and index.ts:11.
3. Interrupted polling errors direct fresh get_ui: windows/batch.ts:250 and windows/automation.ts:51. Pause/cancel/timeout tests assert guidance and worker cleanup.
4. cmd, powershell, pwsh, wscript, cscript and mshta are rejected by bare name, .exe name and full path, and after shortcut resolution: windows/batch.ts:66 and uia-worker.cs:170/223. Native smoke rejects a Start Menu alias to cmd.exe. Launch retains runtime locks and pause/cancellation guards. No input replay.

## Validation and difficulties

build, check, test (99 passed, one existing skip; chat passed), test:windows passed. PNG tests cover scaled/unscaled dimensions, reported sizes, red crosshair thickness and clipping. Retained screenshot runs verified 40/40; fixed-input comparison verified all 40 PNGs. Desktop tests/benchmarks were sequential.

Windows sometimes refused activate. GitHub URL launch succeeded but title query GitHub timed out; I discovered the repository title instead of relaunching. One URL smoke failed activation; it now verifies in the background and focuses the observed unique Document for cleanup, checks foreground/title before closing its owned tab. No production activation fallback changed. ChatGPT initially exposed captions until activate; first menu/navigation reads showed prior views, and re-reading worked. read_text on its blank search returned an object marker; short unclipped get_ui values verified the field.

Capture harness corrections are preserved: assumed backdrop color differed from captured underlay; an early check compared moving marker coordinates; recursive submenu creation displaced the intercepted tray template. The corrected same-coordinate candidate check still rejected one sample. Installed Pokemon connector was disconnected; the same local MCP server through its SDK handled UI control. No screenshot was needed for app navigation; image captures were the requested experiment.

Optional click: movement already uses instant mouse.setPosition (computer.ts:278); nut.js mouse.class.js:239 imposes the calibrated 100 ms autoDelay. I kept that calibration and behavior, so no hover experiment was necessary.

Your exact signed-out/new-chat GitHub workflow was retrieved and saved. That separate product acceptance test was not run: it requires clearing existing authentication, deleting a remote test repo and restarting the live ChatGPT app. No credentials, remote or GitHub repository were changed.

Code/test diff since d097d85: 12 files, 101 insertions / 34 deletions, plus measurement scripts/evidence. No frontend optimization survived. Further reduction would require different PNG settings, changed input calibration, startup/import restructuring, or verified capture exclusion. Narrow UIA is below your threshold. Please give an honest stopping assessment for the SERVER within these constraints, or identify a concrete justified next change. Distinguish this technical review from the unrun GitHub product test; do not claim global impossibility.
