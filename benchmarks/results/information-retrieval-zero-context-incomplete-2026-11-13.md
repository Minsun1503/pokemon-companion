# Information retrieval benchmark

Incomplete: Expected values to be strictly deep-equal:
+ actual - expected

  [
+   '',
+   'HTML\nSource: https://www.sel',
+   ''
-   'encompasses the string',
-   'cross-process communication',
-   'encompasses the string'
  ]


| Mode / corpus | Verified | Retrieval median ms | Workflow median ms |
| --- | ---: | ---: | ---: |
| page_scan:Research article 12000 | 5 | 416.5 | 1392.7 |
| page_scan:Research article 48000 | 5 | 1319.5 | 2392.9 |
| range_single:Research article 12000 | 5 | 638.5 | 1638.2 |
| range_single:Research article 48000 | 5 | 811.0 | 1904.1 |
| range_many:Research article 12000 | 5 | 256.9 | 1255.0 |
| range_many:Research article 48000 | 5 | 330.7 | 1425.4 |

Controlled search corpus quotes researched public documentation, rendered in real Edge; controlled timings exclude internet search-engine latency.

Search and result clicks use actual repository MCP/native UIA. Server state independently checks the exact query and result click.

Retrieval ends only after all three source facts are returned. Page scanning stops at the same requested facts, not at arbitrary complete-page coverage.

MCP/companion startup and tab preparation are excluded. Retrieval and whole search/click/retrieve workflow are measured separately.

Mode order rotates and reverses across paired rounds. One warm browser and native worker are reused; no failed input is replayed.

Range excerpts concern accessible provider text; they are not complete page coverage or a full-document version. No AI inference is measured.

Correctness checks passed: 3.

Live Bing: not requested or not verified.
