# Owned controller fixture comparison

Structured controller acceptance to durable verified record against an owned local HTTP GitHub fixture, including atomic disk journals and 1-second fixture CI. Both variants use identical controller/check/merge logic. Baseline injects 100ms after each adapter operation to simulate client handoffs; it does NOT measure a language model or natural-language request latency. HTTP connection reuse occurs in both variants. No GitHub PRs are created.

| Variant | Success | Verified p50 / p95 ms | Recorded p50 / p95 ms |
| --- | --- | --- | --- |
| handoff_simulation | 20/20 | 1935 / 1969 | 1941 / 1982 |
| controller | 20/20 | 1093 / 1127 | 1096 / 1131 |

All failure and recovery samples are retained in the JSON. CI failure, conflict and changed head must stop; a lost merge response must reconcile with exactly one merge dispatch. The comparison demonstrates removal of configured handoff waits and makes no claim about host inference speed. A separate live PR trace measures the actual GitHub workflow.
