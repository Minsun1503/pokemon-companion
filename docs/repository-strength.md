# Assessing repository strength

Use separate measurements for implementation correctness, native execution reliability, speed, dependency security, and AI task completion. A passed local fixture is useful evidence, but it is not an industry benchmark score.

## Public benchmarks reviewed

Reviewed November 13, 2026 with Pokémon MCP research tools in the existing Edge profile:

| Source | What it tests | Fit for this repository |
| --- | --- | --- |
| [Microsoft Windows Agent Arena](https://github.com/microsoft/WindowsAgentArena) | Agents performing tasks in a reproducible Windows OS environment; scalable evaluation through Azure ML | Closest public target for the native Windows tool surface. Its setup prepares a Windows 11 VM and requires integration of an agent/action interface. |
| [OSWorld](https://github.com/xlang-ai/OSWorld) | Open-ended agent tasks in real computer environments, with VM-backed execution and evaluators | Useful for broad task evaluation. The current docs describe VMware/VirtualBox and Docker/KVM paths, including an Ubuntu guest-image update warning. An MCP server needs an agent adapter and a suitable guest setup. |
| [MCP Inspector](https://github.com/modelcontextprotocol/inspector) | Deterministic MCP server testing and protocol inspection | Useful for server/transport compatibility. It does not measure an AI agent's ability to finish desktop tasks. |

The local suite below uses the repository's existing real MCP/native fixtures. It does not execute or claim a score from those public task datasets.

## Run the local assessment

After the normal dependency setup, run from the source checkout:

```powershell
npm run test:strength
```

This builds the backend/frontend, runs static and automated tests, checks the packaged learning contract and HTTP authentication, then serially checks Windows target identity, discovery bounds, native-worker coordination, and atomic/batched workflows on plain and nested fixture trees. It also audits production dependencies in both projects.

In this machine's compatibility folder above `.publish`, use `npm --prefix .publish run test:strength` instead. Fresh GitHub clones use their normal repository root.

To include browser discovery, verified form entry, search/result opening, passage retrieval, URL navigation, actual PDF text reading, and desktop Excel read/write/calculation/save:

```powershell
# Replace 12345 with the current Edge ID from Pokémon windows get_windows.
npm run test:strength -- --window-id 12345 --runs 20 --common-runs 5 --output benchmarks/results/my-strength-run.json
```

The Edge/Excel suite targets an owned loopback tab and disposable workbooks in the existing Edge profile. Keep the Windows session unlocked and leave desktop input to the suite while it runs. Without `--window-id`, common operations are explicitly skipped. Windows-specific checks are skipped on other operating systems.

The suite refuses an existing output path or evidence directory. It retains child stdout/stderr, raw benchmark JSON and Markdown, failures, blocked cases, and a checkpoint report marked incomplete until all checks settle. Exit code 0 means all selected checks passed; 1 means a failed/incomplete check; 2 means dependency findings or blocked cases. These codes are not numeric quality ratings.

Default timing runs use 20 paired warm attempts per strategy on each of two tree layouts, excluding one warmup per strategy and including separate fresh-session observations. Common operations use five measured attempts per case/strategy; a five-sample p95 is the slowest observed sample. Larger samples can be requested with `--runs 100 --common-runs 20`. This is a short repeatability assessment, not a long-duration resource soak.

## Findings from the November 13 assessment

The initial assessment of commit `2d3962a` found a packaged learning-instruction check that failed although `npm test` passed. Compression removed the exact wording expected by that separate smoke check. The original failure is retained in the baseline evidence rather than removed from the assessment.

The wording now explicitly says `call learning begin` and `verbatim current user request`, preserving the concise guidance. The rebuilt contract check passes. Added `npm run test:learning:contract` to CI so this check is exercised after a build. Guidance now measures 3,425 bytes, below its 3,500-byte cap, with the original tool schema/annotation hash unchanged.

| Assessment layer | Observed result |
| --- | --- |
| Static checks and backend/frontend build | Passed |
| Automated tests | 394 passed, one skipped; another four new reporting checks passed separately |
| Learning initialization/client contract | Failed initially; passed after the wording correction |
| HTTP authentication | Passed: rejects missing/wrong credentials before body parsing |
| Windows bounds and identity | Passed on actual WinForms/Electron fixtures, including 100/101-window coverage and stale-target rejection |
| Native-worker coordination | Passed exclusion, cancellation and owner-termination recovery |
| Plain/deeply nested native workflows | 84/84 recorded workflows verified; four additional warmups excluded |
| Edge/PDF/Excel operations | 100/100 measured attempts passed across ten cases and two strategies; 20 warmups excluded |
| Production dependency audits | Backend: nine moderate affected nodes; frontend: one high affected node |

Raw [baseline assessment](../benchmarks/results/strength-2026-11-13-baseline.json), [native plain-layout results](../benchmarks/results/strength-2026-11-13-baseline-evidence/windows-plain.md), [native nested-layout results](../benchmarks/results/strength-2026-11-13-baseline-evidence/windows-nested.md), and [Edge/Excel results](../benchmarks/results/strength-2026-11-13-baseline-evidence/common-operations.md) preserve the measurements. [Verified guidance size](../benchmarks/results/tool-guidance-verified-2026-11-13.json) records the wording correction. The complete baseline returned exit code 1 because of the original contract failure; it remains a failed baseline even after the targeted repair.

Native timings were close: plain-layout warm medians were 346.1 ms atomic and 335.1 ms batch; nested-layout medians were 526.8 ms atomic and 535.1 ms batch. Calls dropped from six to one, but this run does not establish a general native speedup. Larger gains appeared in specific common operations: passage retrieval measured 549.9/274.5 ms, Excel range reads 424.3/66.6 ms, and Excel write/calculation/save 1,201.5/745.2 ms (baseline/optimized medians). Freshly rooted control discovery was slower, 91.9/126.3 ms. These compare strategies in the same build and exclude AI inference.

After the targeted wording repair, build, static checks, the existing 394 tests, the learning contract, and the guidance budget were rechecked. Four added reporting tests verify malformed audit rejection, abnormal exits, vulnerability findings even on a zero process exit, and correct incomplete/blocked/failure classification; they are included in future `npm test` runs. The timed desktop suite was not repeated after that prose-only repair. Reporting syntax, invalid sample rejection, and refusal to overwrite the baseline report were also checked.

The initial production dependency audits reported nine moderate affected dependency nodes in the backend and one high affected dependency node (`js-yaml`) in the frontend. These counts include transitive propagation; they are not ten independent vulnerabilities or proof that the application's current paths are exploitable. The raw audit output includes advisory identifiers and affected version ranges.

The frontend resolves `js-yaml@4.2.0` through `electron-updater`, as well as development packaging dependencies. The backend resolves `hono@4.13.13` and `@hono/node-server@2.1.4` through the MCP SDK, and `file-type@16.5.4` through nut-js/Jimp. Prioritize compatible dependency updates, then re-run the audit and this suite. The nut-js/Jimp chain has no automatic fix reported by npm audit and needs separate compatibility review. This assessment did not change dependency versions; the findings remain unresolved.

## Interpreting the results

Report passed/attempted and failed/blocked/timed-out counts beside verified completion time and MCP call counts. Keep startup and model inference separate from native execution. Compare versions with the same task fixtures, machine, model settings, app state, and timing boundary. Retain wrong answers and timeouts rather than reporting only successful latency.

For a public Windows Agent Arena or OSWorld comparison, add an agent adapter, pin the benchmark revision/tasks and VM image, use the same model and step limits for all entries, and let the benchmark's independent evaluator determine completion. Publish task IDs, initial states, failure counts, and supported surfaces. A server alone cannot be ranked against complete AI agents.

Missing evidence includes public-dataset agent success, controlled model-latency effects, extended memory/resource soak, physical mixed-DPI multi-monitor behavior, clean-machine installation across operating systems, and a security penetration test.
