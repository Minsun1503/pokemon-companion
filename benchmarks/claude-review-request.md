Please review these actual local benchmark results for Pokemon Companion (public base repository: https://github.com/Minsun1503/pokemon-companion; the local learning changes described here are not yet published).

Our goal: faster desktop automation and reuse of previous workflows, with minimal CPU/GPU use, safe replay, and honest local learning from tool outcomes and explicit user satisfaction.

Architecture: TypeScript/Node MCP server, one reused C# Windows UI Automation worker, serialized desktop actions, Electron companion. Windows batches combine 1-16 sequential discovery/action/verification steps. A CPU-only online logistic workflow ranker uses 2,048 hashed word/trigram features, at most 32 workflows and 8 successful query contexts per workflow. Windows recipes use fresh window/control discovery and current parameter bindings. Mixed-tool tasks become guides. Queries/parameters/API outcomes are locally encrypted (AES-256-GCM, DPAPI key), bounded, redacted, and screenshot pixels are excluded. Satisfaction stays unknown until explicit feedback; no background neural model or GPU allocation.

Machine: Windows, Intel i5-8500T, Node 24.16.0.

Paired native execution results (owned WinForms fixture, four runs per mode, overlay off):
- Six separate recorded MCP calls: median 4,320.71 ms.
- Same six steps in a learned batch replay: median 4,086.51 ms (5.4% less execution time).
- Replay begin+preview planning: 2.86-4.27 ms, excluded from execution median.
- Server/worker startup: 5.06 s; protected learning-store opening after startup: 27.91 ms.
- Eight successful workflows independently verified; a missing button stopped at step 4 with no extra click. These are synthetic tests and ratings, not actual user satisfaction.

Separate earlier parallel experiment (15 runs per mode):
- Four reads through MCP: sequential 2,690.85 ms vs concurrent/queued 2,703.97 ms (no improvement).
- Four native reads: one worker sequential 2,661.49 ms vs two independent workers 2,295.81 ms (13.7% less time). Experimental pool bypasses MCP/overlay; its snapshots are worker-local and not safely routed to production actions.
- Atomic workflow 3,702.89 ms vs regular batch 3,659.50 ms (1.2% less time). Do not compare these directly with the newer run; conditions differ.

Model/journal microbenchmark at 32 workflows:
- Lookup: median 0.430 ms, p95 0.793 ms, 500 runs.
- Ranker weight update only: median 0.013 ms, p95 0.018 ms, 2,000 runs.
- Recorded diagnostics call including encrypted persistence: median 2.182 ms, p95 3.400 ms, 200 runs.
- Seed/train one workflow (begin, receipt, finish, test rating): median 6.730 ms, 32 runs.
- Projected learning state: 132,989 bytes; total benchmark Node RSS 67.3 MiB including runtime/dependencies/GC effects.
- Four held-out similar queries selected the intended workflow; two unrelated queries returned no match. This tiny evaluation establishes no broad accuracy claim.

Companion: idle wandering/GIF playback is now off by default, but work/travel animations remain. Unchanged tray menus/window shapes are cached and hidden windows skip motion work. Short, separate idle samples: animated mode main/renderer/GPU-process CPU 0.64/1.61/3.07%; still mode 0.20/0.09/0.02%. GPU-process CPU is not hardware GPU utilization; these samples include the test harness and do not establish a universal reduction. Electron baseline memory remains substantial. A single WMI GPU-engine snapshot showed zeros, not a utilization average.

Limits: no external AI inference/round-trip latency, token savings, broad application speedup, long-duration resource measurements, or statistically strong confidence intervals were measured. Native scanning/identity verification dominates. Production input serialization and safety guards are retained. Screenshots remain an on-demand fallback for visual content not exposed through APIs.

Please give your top three concrete, prioritized improvements. Explain the mechanism, tradeoffs, replay/pause/cancellation safety requirements, and a controlled benchmark to verify each. Challenge our measurement methodology and learning model where appropriate. Prefer small, measurable changes over an expensive neural model or unproven parallel pool. Separate evidence from hypotheses, and include pseudocode only when it clarifies a recommended implementation.
