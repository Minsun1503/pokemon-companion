# Information retrieval benchmark

Incomplete: Choose an existing Edge window with --window-id; no new signed-out profile is created.

2 !== 1


| Mode / corpus | Verified | Retrieval median ms | Workflow median ms |
| --- | ---: | ---: | ---: |
| page_scan:Research article 12000 | 0 | — | — |
| page_scan:Research article 48000 | 0 | — | — |
| range_single:Research article 12000 | 0 | — | — |
| range_single:Research article 48000 | 0 | — | — |

Controlled search corpus quotes researched public documentation, rendered in real Edge; controlled timings exclude internet search-engine latency.

Search and result clicks use actual repository MCP/native UIA. Server state independently checks the exact query and result click.

Retrieval ends only after all three source facts are returned. Page scanning stops at the same requested facts, not at arbitrary complete-page coverage.

MCP/companion startup and tab preparation are excluded. Retrieval and whole search/click/retrieve workflow are measured separately.

Mode order rotates and reverses across paired rounds. One warm browser and native worker are reused; no failed input is replayed.

Range excerpts concern accessible provider text; they are not complete page coverage or a full-document version. No AI inference is measured.

Live Bing: not requested or not verified.
