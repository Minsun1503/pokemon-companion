# Actual GitHub form workflow — November 13, 2026

All three final scheduled requests completed with exact full field readback, Pokémon completion and learning finish. A later update of the review description also completed. No PR was submitted. The measurements use the actual GitHub comparison form in an existing signed-in Edge profile, not a loopback replica.

| Sample | Connection | Request to verified fields | Request to finished client task |
| --- | --- | ---: | ---: |
| Final sequence 1 | Cold | 5,705.7 ms | 5,722.6 ms |
| Final sequence 2 | Reused | 1,827.2 ms | 1,842.6 ms |
| Final sequence 3 | Reused | 1,815.6 ms | 1,831.6 ms |
| Later review-description update | Cold | 5,826.9 ms | 5,844.6 ms |

Timers begin when the source client accepts a structured form request. They include validation, connection/native startup, encrypted learning setup, URL and overwrite checks, native document scrolling, field writes and full live readback. Cold connection and first learning-status/native readiness cost about 3.5–3.6 seconds. Warm requests reuse the connection and cache learning status. Field work and verification execute in one 14-step exclusive Windows batch without another agent decision between steps.

Node/module startup, request-file reading/generation, page preparation, external-agent inference and content composition are excluded. These are **not** complete natural-language request timings. The earlier 455-second agent task had a wider boundary and development/setup failures; no direct speedup ratio is valid. Two warm samples are too few for a reliable tail distribution.

The final sequence began with reviewed text already in the fields. Its first two samples changed the description; its third repeated the resulting text. The later cold run updated validation counts and recorded the measured results in the review description. Each request checked every field before the first field write, wrote each field once and verified its entire value. Native scrolling revealed the title that long description entry had moved out of view.

## Retained diagnostics

- Three initial requests targeted the earlier comparison form after its tab changed and the prior commits were merged into main. They stopped before any field write; the cold failure cost 4.27 seconds and the warm failures 43–48 ms. They are failed samples, not fast successes.
- Two development requests verified their fields but failed client completion because `pokemon done` was attributed to a task already closed by `learning finish`. The client now calls done before finish and preserves plain SDK error text. These incomplete outcomes remain recorded.
- Another development request could not discover the title after long text scrolled it offscreen. The reviewed template now accepts a bounded, explicitly selected native scroll step and waits for delayed field rendering. It never guesses coordinates or replays an input automatically.

Build and lint/type checks passed, along with 341 backend tests, 29 script tests, the native Windows coverage/error contract, WinForms/Electron identity checks and the built learning/MCP contract. One existing backend test was skipped. New regressions cover delayed full readback, clipped text, bounded timeout, pause/cancellation, stale proof, connection reuse, completion order, SDK error preservation and bounded native scrolling. Benchmark learning profiles are disposable; no user satisfaction ratings were fabricated.

[Raw measurements, hashes and diagnostic samples](request-completion-form-2026-11-13.json) retain all per-call timings and the exact source/build hashes. The source checkout was dirty during final live validation; its subsequently committed client implementation is identified by those hashes.
