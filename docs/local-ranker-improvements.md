# Local workflow ranker improvements — November 13, 2026

The repository's local model is a CPU-only logistic workflow ranker with hashed text features and a bounded library of successful workflows. This change improves selection and rejection around that ranker. It adds no downloaded model, GPU allocation, external inference calls or background training.

## Changes

The matcher now recognizes a small set of English/Vietnamese action hints. A request to read a field no longer matches a workflow that types into it. Explicit negation such as “do not type” and “đừng nhập” suppresses reuse before expensive scoring. Double-quoted, smart-quoted and backtick-delimited text is excluded from these intent hints, so entering the literal text “do not type” remains supported. Multi-action requests must match the known workflow actions; a typing-only recipe cannot satisfy a combined read-and-type task. Unknown language and phrasing still require the client's current-intent review.

New successful workflows retain their recognized action hints. Existing version-1 snapshots load unchanged; executable legacy steps provide edit/interaction hints where possible. Legacy guides with no action metadata remain unknown rather than inventing a capability. Current features, the 2,048 dimensions, normalized vectors, logistic predictions, update rule and existing weights are unchanged.

Negative feedback now retains up to eight rejected query vectors per workflow. A rejected context suppresses that recipe only when it is very close to the request (cosine at least 0.9) and matches at least as well as the workflow's successful contexts. A different successful phrasing remains available. Changing feedback back to satisfied removes the corresponding near-identical negative context and learns the successful phrasing. Repeated identical ratings do not add training examples.

Rejecting the best match must not promote a less relevant workflow. When a candidate is suppressed by its rejected context, remaining suggestions must match at least as well as that candidate. This fixes the competing-workflow failure found in the first development comparison, while permitting an equally or better supported alternative.

The same checks apply to suggestion, executable preview and process-guide selection. Consuming an issued preview also rechecks current reliability and feedback; a later rejection cannot leave an older preview eligible. Existing current-task parameters, single-use previews, fresh discovery, native identity checks, pause/cancellation and input-delivery rules remain in effect. A declined model suggestion means the client continues normal tools.

## Measured results

The [final comparison](../benchmarks/results/local-ranker-final-2026-11-13.md) uses 32 workflows with eight successful contexts each. Both implementations read the same disposable encrypted version-1 snapshot. The 198 synthetic regression cases expand the previous known matching failures; this is not a blind user evaluation.

| Cases | Before correct | After correct |
| --- | ---: | ---: |
| Familiar English phrasing | 64/64 | 64/64 |
| Vietnamese entry aliases | 32/32 | 32/32 |
| Quoted literal text | 8/8 | 8/8 |
| Reject English negation | 0/24 | 24/24 |
| Reject Vietnamese negation | 0/16 | 16/16 |
| Reject a different action on the same field | 0/32 | 32/32 |
| Reject incomplete multi-action workflows | 0/8 | 8/8 |
| Reject unrelated requests | 6/6 | 6/6 |
| Unlearned semantic paraphrases | 0/8 | 0/8 |

All 80 tested incorrect-reuse cases are now rejected. All 104 supported positive cases retain their original complete suggestion lists, scores and ordering. The overall synthetic count is 110/198 before and 190/198 after; this should not be presented as general real-world accuracy. General semantic paraphrases, such as “Update the stock count” for an inventory-entry recipe without that phrasing in its examples, remain unsupported.

The feedback experiment used a request close enough to select an existing invoice workflow, then recorded negative synthetic feedback. The old service suggested another workflow for that request, including after restart. The new service returned no suggestion. The canonical successful query still selected the invoice workflow, and correcting the feedback restored the new phrasing. Regression tests also cover competing workflows, quoted literals, guide checks and rejection of an already issued preview.

| Lookup workload | Before median ms | After median ms |
| --- | ---: | ---: |
| Supported queries | 0.6258 | 0.6360 |
| Negated/wrong-action queries | 0.4815 | 0.0258 |
| Mixed regression queries | 0.5371 | 0.3559 |

Rejected queries are about 19 times cheaper to score, and the mixed workload is 34% faster. Supported-query lookup is approximately 0.01 ms slower because it includes action checks. These are ten counterbalanced block averages per implementation, 100 lookups per block; p95 is across averages rather than individual-request tail latency. They measure model/service cost, not user-request latency or desktop-action speed.

Both implementations preserve the original feature/model module byte-for-byte. Legacy snapshot contents remain unchanged on opening, and successful suggestion parity is verified. New metadata is optional, negative contexts are bounded, and the existing 2 MiB projected-state cap remains. The reported JSON sizes are serialized state after feedback correction, not attributed model heap memory.

## Verification and reproduction

Build and full lint/type checks passed. All 333 backend tests and 21 script tests passed; one existing backend test was skipped. The built MCP learning contract passed. That contract also found package metadata left out the earlier `research` tool; both manifest generators now agree with the server's tool list. The contract uses a disposable learning profile and checks that the new matching module is present.

After building, run:

```powershell
npm run benchmark:ranker -- --baseline "C:\Users\ADMIN\AppData\Local\Temp\pokemon-ranker-before-fd2ce37a4e9346f9a16d4c90ca21f1e3" --output benchmarks/results/local-ranker-final-2026-11-13.json
```

The saved baseline is the exact pre-change compiled backend, with dependencies resolved through a junction to this repository. Another baseline checkout can be used after building it. The benchmark generates synthetic profiles, uses test keys to exclude DPAPI cost, records build/harness hashes, and cleans up its own profiles. It never loads the user's learning profile or creates ratings in that profile. Builds and tests were separate from the final timing run.

[Raw final measurements](../benchmarks/results/local-ranker-final-2026-11-13.json) include every case, timing block, CPU duration, feedback/restart checks and compatibility assertions. [Development trial](../benchmarks/results/local-ranker-trial-2026-11-13.md) records the earlier successful comparison. Changes remain local; automatic GitHub pushing remains paused.
