# External MCP client tool-selection benchmark — November 12, 2026

The useful optimization is to eliminate a client continuation that only requests an already-known observation. Once the client chooses an input, send that input and its follow-up `get_ui` together. Read the returned observation before choosing the next input. In this controlled run, that reduced workflow calls by **50%** and mean measured execution-window time from **34.652 s to 10.098 s**, with **8/8 correct actions** and **4/4 independently verified completed workflows**.

This is an active Codex orchestration measurement, not isolated model inference or a production Claude benchmark. The pauses include model/client work, tool rendering, scheduling, CLI startup and transport. Two trials per policy are insufficient to predict a general speedup. The action choices themselves remained two per workflow.

## What changed

- Server instructions now distinguish a known action-plus-observation segment from an unknown future branch. The Windows action schema and tool description give the same guidance.
- Repeated detailed Windows guidance was removed from the server instructions; the Windows tool still carries discovery, targeting, retry and delivery rules. Learning and research guidance remain.
- Optional `POKEMON_TIMING=1` diagnostics now measure per-task handler time and handler-completion-to-next-handler gaps. They preserve results/errors, exclude arguments and app contents, bound retention to 32 chains, and exclude overlapping calls from serial attribution.
- A native WinForms fixture and interactive MCP controller provide independently checked dependent workflows, without exposing future instruction text during selection.

No new dependency, neural model, training job or change to Windows input execution was added. The local workflow ranker does not own the external MCP client's tool selection. A faster ranker cannot remove a seconds-long external continuation by itself.

## Method and environment

Hardware: Intel Core i7-1165G7 @ 2.80 GHz, Windows build 10.0.26200, Node v22.12.0. Run timestamps: approximately 06:43–06:46 UTC. The report's `created_at` is controller startup before the trials. Raw samples: [tool-selection-2026-11-12.json](tool-selection-2026-11-12.json).

An active Codex agent read native UI observations and chose `set_value`, `toggle`, or `invoke`. Calls traveled through a short-lived Node CLI, authenticated loopback controller, actual MCP client/server using in-memory transport, and the real Win32/UIA worker. The overlay was replaced with an inert companion and the learning journal used an isolated temporary key/profile. Production overlay, DPAPI startup and stdio overhead were not benchmarked.

Four trials used ABBA order: atomic, fused, fused, atomic. Trials 0/1 shared one edit/button case; trials 2/3 shared one checkbox/button case. Case names and edit tokens were generated, and control order was shuffled per pair. These particular draws both placed the button second. Repeated paired cases introduce familiarity; they are not eight independent unseen language prompts.

Only the current instruction was visible. Disabled future controls were visible, but the agent selected the next action only after reading the preceding result. Each correct input advanced the fixture to the next instruction. The controller inspected final fixture state separately and asserted exactly two correct actions, zero wrong actions, and completion. The agent did not read future stage files while selecting actions.

The fixture reveals a fixed two-step sequence after each successful input; it does not exercise conditional branch alternatives. Its instructions use exact control labels, rather than open-ended requests or ambiguous paraphrases.

Both policies used the same server build and batch capability. Atomic required input, separate observation, next input, separate observation. Fused required input-plus-observation, then another input-plus-observation selected from the first result. Both performed two input dispatches and two observations. This tests orchestration, not a causal before/after test of shorter wording.

## Per-trial results

The execution window starts at the first chosen-input handler entry and ends when the final observation handler completes. It excludes fixture startup, learning begin, window discovery, the initial observation, first-decision gap and the subsequent independent verification command.

| Trial | Policy | Case | Workflow calls | Execution window, s | Handler time sum, ms | Between-call gaps sum, s | Correct / wrong | Completed |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| 0 | Atomic | Edit, button | 4 | 40.179 | 309.131 | 39.869 | 2 / 0 | Yes |
| 1 | Fused | Edit, button | 2 | 8.257 | 245.976 | 8.011 | 2 / 0 | Yes |
| 2 | Fused | Checkbox, button | 2 | 11.938 | 240.324 | 11.697 | 2 / 0 | Yes |
| 3 | Atomic | Checkbox, button | 4 | 29.124 | 286.417 | 28.837 | 2 / 0 | Yes |

UTC window durations have millisecond timestamp resolution; handler/gap sums use a monotonic clock, so small rounding differences are expected.

| Aggregate | Atomic, 2 trials | Fused, 2 trials |
| --- | ---: | ---: |
| Correct action choices | 4/4 | 4/4 |
| Verified complete workflows | 2/2 | 2/2 |
| Workflow MCP calls | 8 | 4 |
| Native input / observation steps | 4 / 4 | 4 / 4 |
| Mean execution-window time | 34.652 s | 10.098 s |
| Mean handler time per workflow | 297.774 ms | 243.150 ms |
| Mean between-call gaps per workflow | 34.353 s | 9.854 s |
| Returned workflow JSON bytes | 2,465 | 2,642 |

The observed execution-window reduction is **70.86% (3.43×)**. Client gaps account for approximately **99.1%** of the atomic execution windows and **97.6%** of the fused windows. Fused observations contain a batch envelope, so total result JSON grew **7.18%** in this small case; fewer calls do not automatically mean fewer output bytes or tokens.

Workflow calls exclude setup. Including the two initial Windows discovery/observation calls gives six versus four Windows calls per trial (33.3% fewer). Adding learning begin/finish gives eight versus six MCP calls (25% fewer). No token, cost or isolated model-request counts were available.

## Client continuation gaps

These statistics exclude setup, the first chosen-input gap and final independent verification. p95 uses the nearest-rank sample; with these small counts it equals the maximum and is not a reliable population tail estimate.

| Transition | n | Median, s | Minimum, s | Maximum / sample p95, s |
| --- | ---: | ---: | ---: | ---: |
| Atomic, all workflow continuations | 6 | 7.925 | 6.890 | 24.580 |
| Atomic, input → observation | 4 | 11.224 | 6.890 | 24.580 |
| Atomic, observation → next input | 2 | 7.394 | 7.114 | 7.674 |
| Fused, observed batch → next chosen batch | 2 | 9.854 | 8.011 | 11.697 |

The fused policy removes the input → observation pauses. Its remaining next-action gap was not faster than the atomic next-action gap in these samples. The mechanism supported by the data is fewer continuations, rather than faster selection on each continuation.

| Excluded timing | Trial 0 | Trial 1 | Trial 2 | Trial 3 |
| --- | ---: | ---: | ---: | ---: |
| Initial observation → first chosen input, s | 7.911 | 9.034 | 8.778 | 19.462 |
| Fixture start → final observation, s | 49.140 | 17.625 | 21.089 | 48.979 |
| Final observation → independent verification command, s | 11.755 | 22.847 | 10.699 | 10.205 |

The last row is benchmark/client bookkeeping delay, not Windows execution or an additional required API choice. Discovery server times were 549.079/204.101 ms in the first cold window/initial-UI reads, then 60.578–93.472 ms per setup read in later trials. Setup is excluded to avoid conflating startup with the action-selection loop.

## Server and native execution

| Workflow handler calls | n | Median, ms | Minimum, ms | Maximum / sample p95, ms |
| --- | ---: | ---: | ---: | ---: |
| Atomic | 8 | 62.834 | 46.918 | 127.835 |
| Fused | 4 | 121.572 | 103.276 | 139.879 |

A fused call runs both input and observation, so its per-call time is naturally larger. `server_ms` includes learning attribution/recording; existing `[pokemon-timing]` spans measure the underlying handler and native worker phases separately.

| Trial | Underlying handler sum, ms | Worker round-trip sum, ms | Native action + discovery inclusive sum, ms | Actual pattern-action sum, ms | Queue wait sum, ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 300.530 | 298.281 | 268.558 | 39.703 | 0.183 |
| 1 | 243.254 | 238.668 | 228.948 | 35.946 | 0.056 |
| 2 | 238.060 | 236.444 | 227.218 | 42.202 | 0.057 |
| 3 | 281.166 | 280.213 | 262.275 | 47.452 | 0.101 |

These columns are overlapping views of the same work, not additive costs. Native action and discovery are separate top-level steps; their nested identity/tree/pattern spans must not also be added. The batch executor already existed, and this small run does not establish a native execution speedup. Queue contention was negligible in this fixture.

## Advertised context size

The before-build was saved immediately before this investigation. Thus it includes earlier repo work, rather than comparing against Git HEAD. Both contracts were read through the actual MCP SDK. Sizes are UTF-8 bytes, not token estimates.

| Contract | Before | During measured trials | Final reviewed build |
| --- | ---: | ---: | ---: |
| Server instructions | 3,642 | 3,042 | 3,042 |
| Tool descriptions + schemas JSON | 25,758 | 25,799 | 25,858 |
| Instructions + tool JSON | 29,400 | 28,841 | 28,900 |
| Descriptions if instructions are repeated on all 7 tools, characters | 34,392 | 30,192 | 30,251 |

Final server instructions are **16.47% smaller**; total advertised bytes are **1.70% smaller**. Expanded description characters are **12.04% smaller** for clients that repeat instructions per tool. This is a hypothetical client expansion count, not an observation of how Claude/Codex constructs a model prompt. Tool action names, defaults, validation, guards and schema structure remain compatible; the Windows action field's description changed. All other tool schema byte counts match the baseline.

The final review removed an ambiguous sentence from the Windows tool description and made overlapping timing gaps explicitly null. The raw benchmark preserves the hashes and contract actually measured; those final wording/overlap changes were not timed again. The native DLL was regenerated by the normal build, with its source unchanged during this final review. `index.js`, `learning/instructions.js` and `learning/instrument.js` still match their recorded hashes. The final native contract check covers the regenerated worker.

## Verification and limits

Backend suite: **310 passed, 1 existing skip**. The five focused timing/attribution checks passed again after final formatting. Backend build, lint for the changed backend files, learning MCP contract smoke, native Windows contract smoke, and diff whitespace checks passed. The fixture independently checked every completed trial, rather than using MCP delivery success as the completion oracle.

No Claude API call, provider token telemetry, isolated inference benchmark, larger paraphrase corpus, production stdio workflow, or dense browser/application task was measured. Previous local-ranker and native-only benchmarks measure different parts of the workflow and cannot substitute for these client gaps. Earlier longer calibration attempts hit reference expiry and were aborted without publishing success figures. This final four-trial run had zero failed workflow calls and required no refresh. Window references still expire after two minutes; use fresh discovery after a confirmed safe rejection, never replay delivered or uncertain input.

The next useful evidence is repeated traces from the user's actual MCP client, with its model/configuration identified. Those can show whether time is dominated by model deliberation, rendering, transport or other scheduling. Only client-side timestamps can isolate inference. A local shortlist/router should be evaluated against those real requests for accuracy and fallback rate before replacing general model judgment; this run does not justify an additional model or claim training-time improvements.

Reproduction and trace interpretation: [docs/tool-selection.md](../../docs/tool-selection.md). Sources: [controller](../../scripts/tool-selection-benchmark.mjs), [native fixture](../../scripts/tool-selection-fixture.cs). Preserve the dated raw report before repeating because the harness writes a fixed output filename.
