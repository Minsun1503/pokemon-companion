# Local workflow ranker comparison

All measurements complete.

| Case group | Before correct | After correct |
| --- | ---: | ---: |
| supported | 64/64 | 64/64 |
| vietnamese_alias | 32/32 | 32/32 |
| negation_english | 0/24 | 24/24 |
| negation_vietnamese | 0/16 | 16/16 |
| different_action | 0/32 | 32/32 |
| incomplete_multi_action | 0/8 | 8/8 |
| quoted_text | 8/8 | 8/8 |
| unrelated | 6/6 | 6/6 |
| unlearned_semantics | 0/8 | 0/8 |

| Lookup workload | Before ms | After ms |
| --- | ---: | ---: |
| positive | 0.6258 | 0.6360 |
| rejected | 0.4815 | 0.0258 |
| mixed | 0.5371 | 0.3559 |

Feedback and restart checks: `{"before":{"rejected_query_suggested_again":true,"rejected_query_suggested_after_restart":true,"successful_still_available":true,"corrected_available":true,"state_bytes":343455},"after":{"rejected_query_suggested_again":false,"rejected_query_suggested_after_restart":false,"successful_still_available":true,"corrected_available":true,"state_bytes":343497}}`

Synthetic regression corpus expanded from the previous known failure cases; not a blind representative user evaluation or threshold tuning experiment.

English/Vietnamese action and negation vocabularies are conservative lexical hints, not general multilingual understanding. Unlearned semantic paraphrases remain unsupported.

Latency reports ten counterbalanced block averages per arm, 100 lookups/block; p95 is across averages, not individual-request tail latency.

Disposable encrypted profiles and synthetic test ratings only; the user learning profile is not read or modified. Test keys bypass DPAPI.

No GPU, pretrained embedding runtime, cloud inference or UI execution is measured. Existing current-intent review and fresh-target checks remain necessary.
