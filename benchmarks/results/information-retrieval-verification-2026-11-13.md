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
| range_many:Research article 12000 | 1 | 352.6 | 1251.7 |
| range_many:Research article 48000 | 1 | 342.4 | 1402.3 |

Controlled search corpus quotes researched public documentation, rendered in real Edge; controlled timings exclude internet search-engine latency.

Search and result clicks use actual repository MCP/native UIA. Server state independently checks the exact query and result click.

Retrieval ends only after all three source facts are returned. Page scanning stops at the same requested facts, not at arbitrary complete-page coverage.

MCP/companion startup and tab preparation are excluded. Retrieval and whole search/click/retrieve workflow are measured separately.

Mode order rotates and reverses across paired rounds. One warm browser and native worker are reused; no failed input is replayed.

Range excerpts concern accessible provider text; they are not complete page coverage or a full-document version. No AI inference is measured.

Correctness checks passed: 3.

Live Bing: not requested or not verified.
