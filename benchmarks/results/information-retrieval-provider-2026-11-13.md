# Information retrieval benchmark

Incomplete: Unknown, expired or mismatched window identity. Call get_windows again.

| Mode / corpus | Verified | Retrieval median ms | Workflow median ms |
| --- | ---: | ---: | ---: |
| page_scan:Research article 12000 | 1 | 502.8 | 1354.0 |
| page_scan:Research article 48000 | 1 | 1246.2 | 2198.5 |
| range_single:Research article 12000 | 1 | 586.6 | 1555.3 |
| range_single:Research article 48000 | 1 | 781.5 | 1854.1 |
| range_many:Research article 12000 | 1 | 242.9 | 1223.8 |
| range_many:Research article 48000 | 1 | 306.2 | 1397.8 |

Controlled search corpus quotes researched public documentation, rendered in real Edge; controlled timings exclude internet search-engine latency.

Search and result clicks use actual repository MCP/native UIA. Server state independently checks the exact query and result click.

Retrieval ends only after all three source facts are returned. Page scanning stops at the same requested facts, not at arbitrary complete-page coverage.

MCP/companion startup and tab preparation are excluded. Retrieval and whole search/click/retrieve workflow are measured separately.

Mode order rotates and reverses across paired rounds. One warm browser and native worker are reused; no failed input is replayed.

Range excerpts concern accessible provider text; they are not complete page coverage or a full-document version. No AI inference is measured.

Correctness checks passed: 9.

Live Bing: not requested or not verified.
