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
