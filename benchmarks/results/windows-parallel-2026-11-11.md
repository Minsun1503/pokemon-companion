# Parallel Windows inspection experiment

Revision: df6ba20d211fc7a2108c660fd964df08d9ce9589. 15 warm runs per mode; alternating order. Pokémon visible for MCP tests. Two disposable WinForms windows.

| Mode and group width | Runs | Median ms | p95 ms |
| --- | ---: | ---: | ---: |
| mcp_sequential_2 | 15 | 1324.7 | 1516.3 |
| mcp_concurrent_queued_2 | 15 | 1330.9 | 1591.9 |
| native_sequential_2 | 15 | 1289.6 | 1385.9 |
| native_concurrent_one_worker_2 | 15 | 1336.0 | 1565.1 |
| native_parallel_two_workers_2 | 15 | 1145.7 | 1616.9 |
| mcp_sequential_4 | 15 | 2690.8 | 2815.9 |
| mcp_concurrent_queued_4 | 15 | 2704.0 | 3509.5 |
| native_sequential_4 | 15 | 2661.5 | 2795.6 |
| native_concurrent_one_worker_4 | 15 | 2667.0 | 2796.7 |
| native_parallel_two_workers_4 | 15 | 2295.8 | 2422.2 |
| atomic_workflow | 15 | 3702.9 | 3997.2 |
| batch_workflow | 15 | 3659.5 | 3955.6 |

All read results were checked against known field contents; neither field values nor click counts changed during the read experiment. Every dependent workflow was independently checked against the fixture's state file. All completed samples and server timing logs are in the adjacent JSON.

Startup: {"two_native_workers_ms":2754.4800000000005,"mcp_and_overlay_ms":1677.2011000000002}

Timing profile (median per MCP call):

```json
[
  {
    "mode": "atomic_workflow",
    "calls": 90,
    "note": "Measured six-step dependent workflows only; startup, read-group experiments and warmups excluded.",
    "breakdown_median_ms": {
      "queue_wait": 0.018499999976484105,
      "companion_before": 2.690000000031432,
      "action": 706.2663499999908,
      "companion_after": 0.37754999997559935,
      "worker_round_trip": 707.7161999999953,
      "uia_tree_walk": 307.45305,
      "serialization": 0.026599999982863665
    }
  },
  {
    "mode": "batch_workflow",
    "calls": 15,
    "note": "Measured six-step dependent workflows only; startup, read-group experiments and warmups excluded.",
    "breakdown_median_ms": {
      "queue_wait": 0.03200000000651926,
      "companion_before": 25.44350000011036,
      "action": 3627.319099999906,
      "companion_after": 2.5019999999785796,
      "worker_round_trip": 3628.8227999999654,
      "uia_tree_walk": 2027.0848,
      "serialization": 0.11800000007497147
    }
  }
]
```

- Two owned WinForms processes; no arbitrary application speedup established.
- Native worker pool is experimental and bypasses MCP/overlay overhead; compare it with native sequential, not MCP modes.
- Pool results contain worker-local snapshots. They cannot be used by the production action worker.
- Production dispatcher and desktop input serialization remain unchanged.
- Only get_ui is sent concurrently to separate workers. Dependent write/click workflows remain sequential.
- Warm local execution, transport and result parsing. Verification and startup excluded. No model inference or AI end-to-end latency.
- Parallel reads are separate observations, not an atomic snapshot of multiple apps.
- A production pool needs scoped reference routing, pause/cancellation handling, memory limits and protection against provider stalls.

Reproduce after building: `node scripts/windows-parallel-benchmark.mjs 15 benchmarks/results/windows-parallel-2026-11-11.json`. Requires the existing companion HTTP server on port 3000.

Validated measured totals: 450 independent read checks and 30 dependent workflows.
