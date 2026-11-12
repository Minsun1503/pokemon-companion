# Research-led Windows observation improvements

Measured November 12, 2026. [Raw samples and build hashes](windows-observation-2026-11-12.json) accompany this report. Benchmarks compare Pokémon Companion before and after this task's changes.

## Repositories studied

Source checkouts were fetched from GitHub and inspected at these exact commits. No upstream implementation was copied and no dependencies were added.

| Reference | Source studied | Decision for Pokémon Companion |
| --- | --- | --- |
| CursorTouch/Windows-MCP, `a967dd5e2125b7939b0057a3cdcac4905efd87a8` | [Cache requests](https://github.com/CursorTouch/Windows-MCP/blob/a967dd5e2125b7939b0057a3cdcac4905efd87a8/src/windows_mcp/tree/cache_utils.py), [capture budgets](https://github.com/CursorTouch/Windows-MCP/blob/a967dd5e2125b7939b0057a3cdcac4905efd87a8/src/windows_mcp/tree/budget.py), [Unicode regression cases](https://github.com/CursorTouch/Windows-MCP/blob/a967dd5e2125b7939b0057a3cdcac4905efd87a8/tests/test_surrogate_repair.py) | Reuse values already fetched in our fresh UIA cache; keep bounded output and avoid cutting an emoji pair during Node response trimming. |
| sbroenne/mcp-windows, `36b68634eab6711a179b0419814b3c02126bdea5` | [Cached article extraction](https://github.com/sbroenne/mcp-windows/blob/36b68634eab6711a179b0419814b3c02126bdea5/src/Sbroenne.WindowsMcp/Automation/UIAutomationService.Article.cs), [text-reading safeguards](https://github.com/sbroenne/mcp-windows/blob/36b68634eab6711a179b0419814b3c02126bdea5/src/Sbroenne.WindowsMcp/Automation/UIAutomationService.Text.cs), bounded search traversal | Separate efficient observation from action verification. Our discovery reads can use their fresh cache; identity revalidation, explicit text reads, and post-action field verification still use fresh/live evidence. |
| capturingthe3rd/Desktop_Ash, `15a7ca4b57055c4f4154dff32904f3e0cb2061e5` | [Animation scheduling](https://github.com/capturingthe3rd/Desktop_Ash/blob/15a7ca4b57055c4f4154dff32904f3e0cb2061e5/src/renderer/renderer.ts), state queue | Its frame scheduling and reduced-motion handling are relevant to the pet overlay. Our controller already skips static idle rendering and supports reduced motion. Further timer changes were deferred pending idle CPU measurements. |

## Implemented changes

1. `backend/src/windows/uia-worker.cs`: discovery projects `ValuePattern.Cached.Value`, already included in each fresh cache request, instead of performing another `Current.Value` read for every returned field. Name/identity and value evidence therefore use the same per-node capture. Input checks and post-action value reads remain live.
2. `backend/src/windows/automation.ts`: bounded text output now finds the longest prefix that fits the escaped JSON budget. The previous trimming subtracted encoded overflow from unencoded text length, unnecessarily discarding useful text. The search uses complete UTF-16 pairs so this trimming step does not split an emoji.

Seven regression cases cover plain text, quotes/newlines/backslashes, control characters, emoji, mixed language, and unchanged text that already fits. Tool schemas and native limits are unchanged.

## Timing measurements

Environment: Windows `10.0.26200`, Intel Core i7-1165G7, Node `v22.12.0`. Both implementations use cached child navigation. The baseline was saved before these edits from revision `209c6ce432026dfead89a2c852d6a812e1de62a2`; earlier uncommitted work was retained in both arms. JSON records SHA-256 hashes of each arm's compiled adapter, native source, and native DLL.

The same owned WinForms window exposes 30 named fields with independently known values. Each arm has a separate persistent worker and one excluded warmup. Fifteen ABBA blocks give 30 warm samples per arm. Worker startup is recorded separately. Assertions run after the timer stops.

| Measurement | Before median | After median | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: |
| Full native inspection request, profiling off | 302.690 ms | 296.704 ms | 324.965 ms | 322.274 ms |
| Value-reading phase for all 30 fields, separate profiling run | 1.124250 ms | 0.003600 ms | 2.081205 ms | 0.004255 ms |

The instrumented value-reading phase fell by **99.68%**, saving about **1.121 ms per 30-field capture** in that separate run. It measures the selected phase, not provider RPC counts or the whole inspection.

The full request median was **1.98% lower**, but the paired median saving was only **1.672 ms**. A fixed-seed, 2,000-resample bootstrap preserving the 15 ABBA blocks gives a 95% interval of **−3.847 to +14.390 ms** for the paired median saving. That interval includes zero: this run does **not establish a reliable full-request speedup**.

## Useful text within the same limit

Each synthetic input contains 8,000 UTF-16 units. Both arms receive the same **6,000-character escaped JSON response budget**, including metadata. An independent oracle grows the expected prefix one Unicode character at a time and checks the resulting JSON size.

| Input | Before returned UTF-16 units | After returned UTF-16 units | Result |
| --- | ---: | ---: | --- |
| Plain text | 5,951 | 5,951 | Same useful output |
| Quoted lines with backslashes | 4,445 | 4,999 | **12.46% more text** |
| Emoji | 5,946 | 5,950 | 2,973 → 2,975 complete emoji |
| Escaped control characters | 0 | 991 | Useful prefix instead of an empty response |
| Vietnamese/Japanese/emoji/quotes | 5,080 | 5,357 | **5.45% more UTF-16 units** |

This is a correctness/output-utilization improvement with a small processing cost. Thirty samples per arm/input each average 200 in-process packing operations, after 100 warmups. For quoted lines, median packing time changed from **0.0525 to 0.2010 ms**; for mixed language, **0.0771 to 0.3086 ms**. Across these inputs, the additional median cost was approximately **0.09–0.23 ms per response**. All returned prefixes fit their budget; all five new outputs matched the independent oracle.

## Verification

- **120 native captures / 3,600 expected field values** checked across the timing and profiling runs.
- Both implementations saw independently changed field text on a fresh capture; both writes were checked against the fixture's independently recorded state.
- **304 backend tests passed; 1 existing test skipped.** Backend build and focused ESLint checks passed.
- WinForms and Electron native smoke checks passed for dense discovery, subtree editing, pinned absence, and rejection after name/ID/role changes; WinForms additionally covers description changes.
- Native contract smoke passed for exact/overflow window coverage and pre-action rejection evidence. `git diff --check` passed.

## Reproduce

Before editing the measured files, build the baseline and preserve it outside the checkout:

```powershell
npm --prefix backend run build
$baseline = Join-Path $env:TEMP 'pokemon-observation-before-20261112'
New-Item -ItemType Directory -Path "$baseline/backend"
Copy-Item -LiteralPath backend/dist -Destination "$baseline/backend/dist" -Recurse
New-Item -ItemType Junction -Path "$baseline/backend/node_modules" -Target (Resolve-Path backend/node_modules).Path
```

After applying the changes:

```powershell
npm --prefix backend run build
node scripts/windows-observation-benchmark.mjs --baseline $baseline
```

The saved baseline from this run remains in that temporary directory. The harness compiles and closes its own fixture, asserts every capture, alternates implementations, and writes raw samples and build hashes. It cleans only its newly created, verified temporary fixture directory.

## Limits

This measures one Windows fixture. Native timing includes the adapter and PowerShell transport; it excludes MCP/client framing, the pet overlay, model inference, and independent assertions. Packing is a synthetic microbenchmark. No token/dollar savings, general application speedup, macOS/Linux performance, idle CPU improvement, or improvement in model task success was measured.

Caches are refreshed for each capture and are not an atomic whole-window snapshot. Existing provider/native source caps remain. Reconnect an already running MCP server to load the rebuilt native worker and adapter. No commit or push was made.
