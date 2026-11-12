# MCP client tool-selection latency

An external MCP client chooses a tool before Pokémon receives the request. Server-side workflow scoring and Windows execution cannot measure that model's inference directly. Optimize the number of client continuations first: batch the chosen input with its follow-up `get_ui` or bounded `wait_for`, read that result, then choose the next segment. Keep observations scoped to the needed window/control and preserve discovery proofs. Unknown future branches still need judgment.

The [dependent-workflow benchmark](../benchmarks/results/tool-selection-2026-11-12.md) includes observed client pauses, server/native time, call counts and independently verified correctness. It compares two orchestration policies using the existing Windows batch executor.

## Measure the real client

Set `POKEMON_TIMING=1` in the MCP server's environment and restart its connection so the client receives the rebuilt instructions. Existing `[pokemon-timing]` stderr lines contain native phase timings. New `[pokemon-client-timing]` lines track serial calls sharing a learning `task_id`.

When learning collection is enabled, use `learning begin`, copy its returned `task_id` into every task tool call, and finish after verifying the outcome. Calls without that ID, including calls while collection is disabled, produce no client-chain trace. Normal execution is unchanged when timing is disabled.

| Field | Interpretation |
| --- | --- |
| `started_at`, `finished_at` | UTC handler timestamps; completion precedes MCP response transmission. |
| `server_ms` | Monotonic elapsed time for the instrumented handler, including local attribution/journal work. SDK validation and transport are outside this span. For `learning begin`, the span starts after initial task creation; existing native timing covers the whole handler. |
| `client_gap_ms` | Previous handler completion to next handler entry for this task; not pure inference. Includes client deliberation, rendering, scheduling, transport and any human wait. `null` means no trustworthy serial predecessor. |
| `previous_tool`, `previous_action` | Predecessor needed to classify a gap, such as input → observation or observation → next input. |
| `overlapping_calls` | Exclude these from serial decision statistics. The first call after an overlap has a null gap. |

Only task IDs, tool/action names and timing metadata are logged by the new trace; it excludes arguments, queries, field text, screenshots and app contents. Stderr collection and retention are controlled by the MCP host, separately from the encrypted learning journal. Logging errors do not alter handler results or original errors. At most 32 task chains are retained; idle chains can be evicted. A new chain is left untraced when all 32 are active. A restart or eviction loses the predecessor.

For a useful production comparison, repeat matched tasks with atomic input/observation calls and fused input-plus-observation batches. Record client/model version, configuration and hardware; use the same response scope. Separate setup and first-decision time, input → observation gaps, observation → next-input gaps, server time, and final outcome verification. Include failed/expired requests and task correctness. Keep overlapping calls and human waits separate. Report sample counts beside median/range/p95; small-sample p95 is often just the maximum.

To isolate inference, the external client must additionally expose request-to-model, first token, final tool-call generation, and response-delivery timestamps. Pokémon cannot obtain those from the MCP handler alone.

## Reproduce the controlled fixture

Build the backend, retain a separate before-build project root containing `backend/dist`, dependencies and package metadata, then start:

```powershell
npm --prefix backend run build
node scripts/tool-selection-benchmark.mjs serve --baseline <before-project-root>
```

The controller prints a connection file. Use `next <connection>` to start each trial, and select actions only from the returned current native UI observation. Never inspect `fixture.json` or future stage data while selecting actions. `call <connection> '<Windows JSON>'` sends the chosen call through the actual MCP client/server/native backend. Atomic trials require a separate observation; fused trials require input plus observation in one batch. Every next input waits for the preceding returned observation. Order is atomic/fused/fused/atomic with paired case data.

When the observation says `Task workflow complete`, call `next` to independently verify fixture state and start the next trial. After the fourth verified trial, call `finish` to save the raw JSON and close owned resources. The harness asserts two correct actions and zero wrong actions per trial. Preserve an existing dated report before running again because the output path is fixed.

Use `refresh <connection>` for fresh window discovery and observation before references expire, or after a confirmed safe stale-reference rejection. It sends no input. Never replay delivered or uncertain input. `abort <connection>` stops only the owned benchmark process/fixture without publishing a success report. The fixture needs Windows and its .NET WinForms compiler; compilation and setup are outside measured action windows.
