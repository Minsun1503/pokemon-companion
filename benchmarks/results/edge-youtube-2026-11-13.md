# Edge → YouTube → search → watch benchmark

Search: **Big Buck Bunny Blender**. Verified 3/3 runs. All requested runs passed.

| Stage | Median ms | Observed p95 ms |
| --- | ---: | ---: |
| total | 8384.1 | 11175.4 |
| open_edge | 1182.9 | 1490.4 |
| open_youtube | 2621.3 | 2825.1 |
| search | 2270.2 | 4525.9 |
| click_video | 676.9 | 736.8 |
| verify_playback | 1886.4 | 2029.8 |

Harness spawns a fresh isolated Edge process/profile per run; application startup is timed. MCP/companion startup is separate.

Repository MCP windows UI Automation for field entry and control invocation; foreground-guarded Enter submits the address bar.

Read-only CDP observes only the dedicated benchmark tab: exact query, selected watch ID, player video ID, no active ad, and at least one second of unpaused media progress.

Total starts before Edge spawn and ends at verified playback. Stage times include UIA discovery, actions, website/network/render waits and read-only verification. Cleanup and MCP startup are excluded.

Fresh browser/profile per run; OS, Edge installation and network caches are not reset. No failed action or workflow is automatically retried.

Live YouTube, consent, sign-in challenges, ads, regional access, UI language and machine load affect results. No AI inference is measured. Small samples do not establish a stable p95.

Raw samples and playback evidence are in the adjacent JSON file.
