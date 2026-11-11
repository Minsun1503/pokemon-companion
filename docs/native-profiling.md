# Native automation profiling

Set `POKEMON_TIMING=1` before starting the server to emit optional
`[pokemon-timing]` JSON lines to stderr. Normal MCP results stay unchanged.
Native diagnostics travel in an internal worker envelope, including rejected
actions, and are consumed in the requesting asynchronous context. Only fixed
phase names and nonnegative numeric times/counts are accepted; window titles,
handles, selectors, field values and protected keys are not included.

`breakdown_ms` contains native phases prefixed with `native_`; `counts` contains
the corresponding completed span counts. Phases ending in `_inclusive` include
their nested phases. Do not add overlapping phases to estimate total time.

Useful phases:

| Phase | Meaning |
| --- | --- |
| `window_enumeration_inclusive` | Visible-window enumeration and metadata/proof collection |
| `tree_walk_inclusive` | Each complete discovery or identity-resolution walk |
| `navigation_cache_fetch` | UIA navigation plus cache population in the same managed request |
| `identity_resolve_inclusive` | Fresh scope resolution, complete scan, uniqueness and identity checks |
| `element_verify_inclusive` | Fresh identity cache, process/window proof and ancestor/scope verification |
| `pattern_action` | The actual focus/invoke/value/selection/toggle/expand/scroll call |
| `post_action_value_read` | Optional fresh value preview after an action |

The managed UIA navigation APIs return properties in their cache request. Their
navigation and property-fetch times cannot honestly be reported as independent
cross-process costs. There are no fixed settle sleeps in this worker.
Span counts count managed API requests, not internal provider RPCs or ETW events.

## Child caching experiment

Fresh per-parent Control View child caches are enabled by default.
`POKEMON_UIA_CHILD_CACHE=1` explicitly selects this traversal
instead of separate first-child/next-sibling calls. The entire bounded tree is
still visited in provider DFS order. This is not a persistent target cache or an
atomic snapshot. Node/depth/time limits, incomplete-scan rejection, Chromium
wrapper flattening, full uniqueness checks, process/window proof, ancestor/scope
validation and immediate pre-action identity revalidation still apply. A child
list exceeding the remaining node budget makes the scan incomplete.

`POKEMON_UIA_CHILD_CACHE=0` selects the original traversal for same-binary
comparison and provider troubleshooting. No automatic action retry is added.

## Reproduction

From the repository root on Windows after building:

```powershell
node scripts/windows-phase-benchmark.mjs --profile
node scripts/windows-phase-benchmark.mjs
node scripts/windows-phase-benchmark.mjs --workflow-cache
node scripts/windows-phase-benchmark.mjs --profile-replay
node scripts/windows-child-cache-smoke.mjs
$env:POKEMON_UIA_CHILD_CACHE = '1'
node scripts/windows-identity-smoke.mjs
```

The pilot profiles three owned WinForms workflows. The controlled benchmark
uses 15 ABBA blocks (30 samples per cache arm), then 30 counterbalanced runs each
of unrecorded atomic, recorded atomic, batch and learned replay. The separate
workflow-cache run compares 30 complete six-step workflows per cache arm in
ABBA order. Each mutation/read/write is independently checked against fixture
state. Raw samples include timings, span counts, medians, quartiles and a seeded
10,000-resample bootstrap interval for the median paired difference.

The benchmark uses the same native binary for both cache arms and separates
startup and warmup. Workflow timing excludes learning begin/preview/finish/
feedback and independent fixture verification. Recorded runs use explicit
synthetic ratings. Profiling overhead remains enabled in both arms. Results
do not establish performance in arbitrary applications, ranker quality, actual
user satisfaction, or external model latency/cost.

The safety harness repeats 200 changed-state scenarios; these are repeated
synthetic checks, not 200 independent real-world tasks. WinForms and Electron
identity/subtree coverage is also exercised by the existing identity harness.
