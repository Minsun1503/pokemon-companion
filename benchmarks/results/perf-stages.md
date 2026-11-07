# Optimization measurements

Each report uses twenty samples per selected scenario per UI mode. All four required commands (`build`, `check`, `test`, `test:windows`) pass before each optimization commit. No dependency changes are included.

## A: cosmetic companion updates

Input still awaits companion startup, pause checks, and a lock-only acknowledgement. Unlocking is ordered and acknowledged too. Cosmetic state is assigned locally, coalesced to the latest pending state, and sent without awaiting renderer work. At most one cosmetic bridge request is in flight; cosmetic errors cannot fail or stall input. The frontend preserves the current lock when applying a cosmetic packet. Older/custom companions retain synchronous lock updates and get a nonblocking cosmetic fallback.

| Scenario, UI on | Baseline median / p95 ms | A repeat median / p95 ms |
|---|---:|---:|
| Window discovery | 56.7 / 79.0 | 45.7 / 61.1 |
| UI narrow | 64.5 / 79.4 | 45.7 / 47.9 |
| Key chord | 48.0 / 52.7 | 41.9 / 45.5 |

The key-chord UI-off control stayed 31.2 -> 31.5 ms. The on/off overhead fell from 16.8 to 10.4 ms. Companion before/after spans also fell. UIA timings varied even with UI off, so not all UI-read gains can be attributed to A.

The [first A run](perf-a.json) was noisy: narrow UI medians rose to 81.0 ms on / 80.2 ms off, compared with 64.5 / 52.1 ms in the baseline. A repeat without concurrent build/test work was justified by that control regression; [repeat samples](perf-a-repeat.json) are preserved alongside the first run. All samples in both runs verified.

Validation: build, check, 53 unit tests (one existing skip), chat test, and real Windows smoke passed. Added checks for coalescing, a stalled/rejected/throwing cosmetic bridge, pause during lock acknowledgement, and existing exclusive ordering. Brief activity/message frames may coalesce, as intended; explicit Pokémon commands still await their updates. Safety/startup/lock failures still block input.

## B1: worker startup

The Windows build compiles C# once into a 13,824-byte assembly. Workers load its bytes instead of compiling on startup; source compilation remains a compatibility fallback when the artifact is absent. Loading bytes avoids holding a file lock on the build output. Server startup now starts the existing persistent worker in the background.

| Cold startup | Immediately before median / p95 ms | After median / p95 ms |
|---|---:|---:|
| UI on | 2226.3 / 2500.6 | 1716.5 / 1936.1 |
| UI off | 1668.7 / 1893.8 | 1390.1 / 1430.5 |

See [before](perf-b-before.json) and [after](perf-b-startup.json). Both reports contain 200 verified samples, including warm reads and field updates, whose timings stayed broadly unchanged. Cold timing varies between desktop runs; the immediate comparison improves 23% on / 17% off, and the original baseline improves 6% / 13%. The after report includes the compiled assembly hash.

Validation: build, check, 54 unit tests (one existing skip), chat test, and real Windows smoke passed. Warmup/reuse has a regression test. The Windows package already copies the whole backend output, so it includes the assembly without a packaging change. Non-Windows builds retain the source files and do not invoke the Windows compiler. No tool names, actions, or safety checks changed.

## B2: cached inspection and bounded traversal

Inspection caches properties and supported patterns, filters before collecting actions, and fetches siblings lazily. It stops at one extra useful match to prove truncation. Field values and snapshot identities remain live; action ownership, runtime ID, password, visibility, enabled, and read-only guards are unchanged. Response trimming serializes the full tree at most twice, then accounts for removed nodes individually.

| Scenario | B1 on median / p95 ms | B2 on median / p95 ms | B1 off median / p95 ms | B2 off median / p95 ms |
|---|---:|---:|---:|---:|
| UI narrow | 68.2 / 82.3 | 26.6 / 39.0 | 54.0 / 92.7 | 19.7 / 31.3 |
| UI wide | 71.3 / 83.0 | 25.3 / 27.4 | 59.1 / 63.9 | 19.3 / 20.9 |
| Set + verify atomic | 96.8 / 116.6 | 45.3 / 54.5 | 76.5 / 106.4 | 31.4 / 52.8 |
| Set + verify batch | 92.7 / 109.8 | 41.8 / 49.6 | 70.3 / 79.7 | 28.9 / 38.5 |

[B2 samples](perf-b-cache.json): all 160 verified. Two incomplete attempts are preserved in [cached-value observations](perf-b-cache-stale.json) and [live-value observations](perf-b-cache-live-stale.json). One first read returned `Benchmark 42` after the DOM contained `Benchmark 43`; another strict batch observed 62 while expecting 63. Faster calls surfaced the already documented UIA proxy lag. Mutable values now use current reads, and a mismatched batch `get_ui` expectation re-reads once with pause/cancellation checked first. Inputs are never replayed. A persistent mismatch still emits the original error and stops subsequent steps. Atomic benchmark verification also includes one extra read in elapsed time when needed.

Behavior differences: truncated `matched` is a lower bound (limit + one), not a complete count; a stale expected value may cause one additional native read. Both preserve ambiguity rejection. Validation: build, check, 58 unit tests (one existing skip), chat test, and Windows smoke passed. Smoke now checks an actual password field is hidden and verifies early element/depth limits. Added large-response bounds, stale-read recovery, and cancellation/pause-before-recheck tests.

## C: plain Windows typing

Uses the installed public keyboard provider to type ASCII in 32-character chunks, bypassing nut.js's JavaScript sleep for every character. Each chunk yields to process pause/cancellation before the next chunk. Keyboard/mouse calibration is unchanged. Unicode still uses the existing clipboard path; ASCII containing NUL retains the old per-character fallback so a C-string terminator cannot discard trailing text. No ASCII clipboard use was added.

| Characters | Baseline on median / p95 ms | C on median / p95 ms | Baseline off median / p95 ms | C off median / p95 ms |
|---|---:|---:|---:|---:|
| 5 | 93.9 / 103.6 | 5.4 / 8.8 | 79.1 / 87.9 | 2.1 / 2.8 |
| 50 | 793.6 / 804.1 | 19.4 / 21.8 | 781.6 / 784.9 | 13.1 / 15.6 |
| 500 | 7812.3 / 7829.2 | 142.7 / 159.4 | 7790.0 / 7797.0 | 129.6 / 136.5 |

The input implementation remained unchanged through A/B, so the baseline supplies its before measurement; A's smaller companion overhead also contributes a few milliseconds. [C samples](perf-c.json): all 120 verified, plus a separate 40-sample [five-character probe](perf-c-probe.json). No global native delay was modified.

Validation: build, check, 62 unit tests (one existing skip), chat, Windows smoke, and real input smoke passed. Input smoke now independently verifies a 500-character letter sequence (`qjzx ` repeated), then the existing Vietnamese/Unicode replacement and click. Tests cover ordering, unchanged calibration, native error identity, NUL fallback, and pause/cancellation between chunks. Cancellation may leave a typed prefix; it never replays or removes input. Other platforms retain their existing typing paths.

## D1: encode screenshots once

Sharp now receives the resized Jimp RGBA bitmap directly instead of decoding an intermediate Jimp PNG. The resize, cursor crosshair, PNG format, quality 80 and compression level 9 remain unchanged. Benchmark verification decodes every PNG and compares its dimensions to the returned coordinate space.

| UI | Before median / p95 ms | After median / p95 ms | After image bytes (median) |
|---|---:|---:|---:|
| On | 702.2 / 774.8 | 587.7 / 635.8 | 180225 |
| Off | 565.7 / 588.3 | 409.3 / 435.5 | 180006 |

[Before](perf-d-before.json) and [after](perf-d-encode.json): 40/40 samples each verified. Payload sizes vary with screen content; no format change. Build, check, 62 unit tests (one existing skip), chat and Windows smoke passed.
