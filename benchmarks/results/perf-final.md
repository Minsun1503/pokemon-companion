# Desktop tool latency: final comparison

November 7, 2026, branch `perf`. Twenty samples per scenario per companion mode; baseline and final each verified **520/520**. Values below are **median / p95 milliseconds**. Client wall time includes stdio; cold startup includes connection, the first Windows call and the first computer call. Fixture setup and independent checks are excluded. Nested timing spans overlap, and SDK envelope serialization is not isolated.

| Scenario | UI on before | UI on after | UI off before | UI off after |
|---|---:|---:|---:|---:|
| Cold startup | 1828.9 / 2069.1 | 1579.7 / 2413.0 | 1605.1 / 1813.8 | 1418.0 / 1680.6 |
| Window discovery | 56.7 / 79.0 | 50.6 / 72.4 | 34.3 / 42.5 | 35.5 / 41.4 |
| UI narrow | 64.5 / 79.4 | 34.8 / 39.7 | 52.1 / 61.1 | 26.0 / 27.3 |
| UI wide | 77.3 / 99.2 | 45.0 / 57.1 | 68.4 / 75.3 | 27.2 / 31.2 |
| Set + verify atomic | 92.4 / 106.3 | 63.7 / 74.9 | 68.4 / 90.9 | 45.4 / 55.4 |
| Set + verify batch | 86.3 / 110.4 | 59.4 / 82.0 | 66.1 / 74.6 | 42.2 / 49.8 |
| Type 5 characters | 93.9 / 103.6 | 7.7 / 14.2 | 79.1 / 87.9 | 2.5 / 3.6 |
| Type 50 characters | 793.6 / 804.1 | 28.5 / 33.7 | 781.6 / 784.9 | 14.7 / 17.0 |
| Type 500 characters | 7812.3 / 7829.2 | 194.4 / 209.4 | 7790.0 / 7797.0 | 167.1 / 196.3 |
| Key chord | 48.0 / 52.7 | 41.5 / 46.5 | 31.2 / 39.5 | 36.8 / 42.4 |
| Left click | 135.7 / 145.7 | 130.5 / 139.3 | 105.8 / 118.4 | 108.1 / 118.1 |
| Screenshot | 741.8 / 889.4 | 555.9 / 651.5 | 613.6 / 824.9 | 418.5 / 461.4 |
| Pokemon say | 5.1 / 8.3 | 5.4 / 9.6 | 0.6 / 1.3 | 0.7 / 1.2 |

With the companion on, median typing of 500 characters improved 97.5%, narrow UI inspection 46.1%, and screenshots 25.1%. The full-run results vary from the focused stage comparisons; those establish each optimization independently in [stage measurements](perf-stages.md). Every final scenario has 20 verified samples per mode.

PNG format, dimensions, crosshair and quality/compression settings are unchanged. Every final PNG is decoded for format/dimension verification. Median image bytes:

| UI | Before | After |
|---|---:|---:|
| on | 183339 | 144053 |
| off | 180088 | 145294 |

Screen content changes payload size and encoding cost. The immediately paired encoding comparison is [D before](perf-d-before.json) versus [D after](perf-d-encode.json).

Regression observations: UI-on cold p95 rose 2069.1 -> 2413.0 ms despite a lower median (1828.9 -> 1579.7). UI-off key-chord median/p95 rose 31.2/39.5 -> 36.8/42.4 ms; that action still uses the original calibrated press/release path. UI-off window discovery and Pokemon say also have small median increases. These desktop measurements do not establish the cause; gains are not uniform and depend on desktop load. No unfavorable result was dropped or replaced by a repeat.

Changes retained: asynchronous latest-state cosmetic updates with synchronous safety locks; precompiled/background-warmed persistent worker; cached inspection metadata and bounded traversal while values/action guards stay live; Windows ASCII typing in cancellable 32-character chunks; one PNG encode from raw RGBA; native launch and bounded control/value waits in atomic calls and batches. The clipping flag, caption-only hint, usage notes and punctuation-key addendum (`0cd59e8`) remain intact.

Behavior differences: cosmetic frames may coalesce; truncated UI `matched` is a lower bound, not an exhaustive count; a mismatched batch value expectation can re-read once without replaying input; typing cancellation can leave a prefix. New wait/launch defaults are 5000 ms with a 15000 ms maximum and ~100 ms polling. Interrupted blocked polling closes the worker, requiring fresh snapshots. Launch ignores shortcut arguments, accepts .exe names/paths or http/https URLs, and reports the resolved target (with an explicit clipping flag if a small response budget clips it). URL launch requires a window query. Existing actions retain their timeout and error text.

Validation: build, check, 79 unit tests (one existing skip), chat test and expanded Windows smoke passed. The native smoke covers PATH/full-path/Start Menu launch, ignored shortcut arguments, delayed controls, exact values, references, timeout, shell-target rejection, default-browser URL and cleanup of only owned windows/files. Separate 500-character letters and Vietnamese/Unicode input smoke passed. Checks cover pause, cancellation, exclusivity, cosmetic bridge failures, password hiding and stale references. Full benchmark verification covered inputs, clicks and PNG dimensions.

Difficulties: Windows refused foreground activation during several setup attempts. Alt, Alt+Tab and the fixture focus endpoint did not immediately resolve it; a fresh fixture probe then verified 40/40 typing samples and the unchanged benchmark completed. No screenshot fallback was needed for recovery and no diagnostic/focus fallback code remains. Native UIA smoke worked in the background when activation was denied. Path comparisons used realpath for Windows short/long aliases. The installed Pokemon connector reported desktop disconnected; validation used fresh local MCP client/server sessions.

Skipped: SDK/import-startup restructuring (outside the requested worker changes); extra ASCII clipboard paths (native chunks give a large gain while reusing existing Unicode clipboard behavior); conditional overlay removal (backend visibility is not authoritative after tray summons, so capture/restore ordering and compositor wait remain); keyboard Run-dialog launch comparison (would change user Run history); new dependencies and pushing. Existing input-method diagnostic reports and failed UIA observations are preserved. The pre-existing backend/package-lock.json modification remains untouched and uncommitted.

Implementation commits:

- ce72704 Measure desktop tool latency before optimization
- d416580 Move cosmetic companion updates off the input path
- bc90d74 Precompile and warm the persistent Windows worker
- 53df899 Cache Windows inspection and stop bounded UI traversal early
- 61e0fbb Remove per-character Windows typing waits with native chunks
- 0ca4737 Encode screenshot RGBA pixels once with Sharp
- 72ec5d4 Add bounded Windows wait and native launch actions

Code/test/fixture/config diff (excluding benchmark results and the unrelated lockfile):

```text
backend/src/index.ts                   |   2 +-
 backend/src/main.ts                    |   1 +
 backend/src/pokemon/companion.test.ts  |  30 ++++
 backend/src/pokemon/companion.ts       |  40 ++++-
 backend/src/pokemon/runtime.test.ts    |  57 ++++++-
 backend/src/pokemon/runtime.ts         |  43 +++--
 backend/src/tools/computer.test.ts     |  58 +++++++
 backend/src/tools/computer.ts          |  43 +++--
 backend/src/tools/pokemon.ts           |   9 +-
 backend/src/tools/windows.ts           |  17 +-
 backend/src/utils/response.ts          |   3 +-
 backend/src/utils/timing.test.ts       |  41 +++++
 backend/src/utils/timing.ts            |  64 +++++++
 backend/src/windows/automation.test.ts |  61 +++++++
 backend/src/windows/automation.ts      |  74 ++++++--
 backend/src/windows/batch.test.ts      |  30 +++-
 backend/src/windows/batch.ts           | 138 +++++++++++++--
 backend/src/windows/polling.test.ts    | 118 +++++++++++++
 backend/src/windows/uia-worker.cs      | 127 ++++++++++----
 backend/src/windows/uia-worker.ps1     |  15 +-
 frontend/src/main/companion/index.ts   |  35 +++-
 package.json                           |   2 +-
 scripts/bench.mjs                      | 302 +++++++++++++++++++++++++++++++++
 scripts/client.mjs                     |   4 +-
 scripts/input-fixture/index.cjs        |   8 +-
 scripts/input-smoke.mjs                |  15 +-
 scripts/windows-fast-path-fixture.cs   |  30 ++++
 scripts/windows-fast-path-smoke.mjs    | 146 ++++++++++++++++
 scripts/windows-smoke.mjs              |  15 +-
 29 files changed, 1416 insertions(+), 112 deletions(-)
```

Raw data: [baseline](perf-baseline.json), [final](perf-after.json), [new actions](perf-e.json), [focus recovery probe](perf-focus-probe.json). Built-artifact hashes are recorded in the benchmark files.
