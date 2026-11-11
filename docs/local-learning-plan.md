# Local learning implementation and verification

The goal is efficient local learning from user requests, exact APIs invoked, tool delivery outcomes and explicit user satisfaction, with faster reuse of prior workflows. Repository downloads and local models are authorized when secure. A downloaded generative model is optional; the selected initial model is an incremental CPU-only logistic workflow ranker using 2,048 hashed multilingual text features.

Required deliverables:

- Encrypted, bounded local interaction records; secrets redacted, no screenshot or complete app-content collection. Retention, disable, export and deletion controls. No outbound training uploads.
- Task-scoped query and API records with duration, success/failure, delivery evidence, independently observed result and satisfaction recorded separately. Missing satisfaction stays unknown.
- A persisted online model trained from these records, including negative feedback, with transparent diagnostics and held-out similarity/ranking tests.
- Verified parametric workflows learned from operations, returned for matching requests. Every replay uses fresh window/control discovery, current-intent review and current parameters; no persisted native handles, snapshots, coordinates, shell commands or generated code execution.
- User feedback through the companion UI, with a local authenticated feedback path and no inferred positive satisfaction.
- Resource measurements for idle cost, retrieval, incremental training, journal overhead and repeated native workflow execution; accuracy/failure measurements must accompany speed claims. No always-running local neural model or GPU allocation.
- Tests of persistence, isolation, corruption, retention, redaction, stale targets, cancellation/pause, failed operations, negative feedback and actual native replay. Keep screenshots available as a fallback.
- Updated MCP documentation and runtime instructions, builds and relevant checks, followed by a requirement-by-requirement audit of the full goal.

This document tracks the full scope. Implementing only telemetry, a recipe cache, or a successful unit test does not complete the goal.

## Completion audit — 2026-11-11

| Requirement | Implemented and verified evidence |
| --- | --- |
| Minimize local model resources | CPU-only 2,048-feature incremental ranker; no neural runtime, GPU allocation, idle training or external provider calls. At 32 workflows, measured median lookup 0.43 ms and incremental update 0.013 ms. Model/journal benchmark records memory, CPU timers, idle file stability and limits. |
| Reduce companion resource use | Still idle sprite by default, work/travel animations retained, optional idle wandering, cached shapes/tray menus and hidden-window guards. Production-renderer checks, static-idle/travel tests, Electron CPU/memory samples and a Windows hardware GPU-engine snapshot are recorded. |
| Learn and reuse operations | Atomic sequences compile into parametric guarded batches; mixed tools become process guides. Weights and successful phrasing contexts persist. Eight successful native executions, including after restart, were independently verified. A missing button stopped with partial-delivery evidence and no extra click. |
| Collect useful outcomes honestly | Redacted task queries/parameters, exact API names, durations, delivery success/failure, observed outcome and explicit satisfaction/source are collected separately. Unknown satisfaction stays unknown. Positive/negative and duplicate/corrected feedback tests pass. No real-user rating is fabricated; synthetic tests use disposable profiles. |
| Protect local data | AES-256-GCM, Windows current-user DPAPI, writer isolation, bounded state/journal, retention on access/write, credential redaction, no screenshot payloads, disable/forget and versioned bounded exports. Corruption, concurrency, compaction, retention, export reconstruction and size-limit tests pass. |
| Preserve replay safeguards | Fresh discovery, single-use/task-bound expiring previews, current parameters and intent review; no persisted handles, screenshots, coordinate clicks, shell launches or generated code. Existing batch/pause/cancellation/stale-reference suites and real native failure test pass. |
| Connect real feedback | Yes/No buttons in the production renderer, trusted IPC, authenticated bridge, encrypted persistence acknowledgment and `user_ui` source all tested end to end. The feedback card was captured and visually inspected. |
| Make it usable from clients | Server and pokemon-work instructions describe task attribution, guarded reuse and honest finish/feedback. Course/Excel now advertise object input fields while retaining their refined union validation and branch defaults. Runtime schemas and generated package tool order match. Documentation covers limits and controls. |
| Validate deployment security | HTTP refuses missing/short configuration and unauthorized requests before body parsing. A DPAPI-token launcher replaces the previous unauthenticated local server. Final live server exposes all seven tools, complete Course/Excel schemas, and enabled learning with zero fabricated tasks/examples. |
| Complete checks | Backend/frontend builds and full lint/type checks passed. 293 backend tests passed (one existing optional test skipped); 10 additional script tests passed. Full learning integration chain passed native replay, production feedback, HTTP authorization and package/schema checks. |

Capabilities and measurement limits are documented in `docs/local-learning.md`; raw samples are in `benchmarks/results/local-learning-*.json`. Final native medians were 4.32 s recorded versus 4.09 s replay, about 5.4% faster for that fixture, with planning measured separately. No general semantic accuracy, external AI latency, token-cost savings or universal resource reduction is claimed. Electron retains baseline memory cost. Existing release archives were preserved; package verification covers built modules, schemas and generated metadata, not a newly published release. The authorized implementation is complete locally; publishing and a production parallel worker pool are outside this change.
