# Information retrieval benchmark

Incomplete: Readiness check timed out: {"window":{"id":"394084","title":"site:learn.microsoft.com/en-us/dotnet/framework/ui-automation/caching-in-ui-automation-clients caching - Search and 4 more pages - Personal - Microsoft​ Edge","process":"msedge","minimized":false,"window_ref":"d5b02823b3df493dad90caa2c359c4d9"},"snapshot":"b0489411d6e0405ca24fdc2fcdf5fae0","nodes":[],"matched":0,"truncated":false,"complete":true,"scanned":122}

| Mode / corpus | Verified | Retrieval median ms | Workflow median ms |
| --- | ---: | ---: | ---: |
| range_many:Research article 12000 | 1 | 345.2 | 1280.0 |
| range_many:Research article 48000 | 1 | 383.5 | 1464.3 |

Controlled search corpus quotes researched public documentation, rendered in real Edge; controlled timings exclude internet search-engine latency.

Search and result clicks use actual repository MCP/native UIA. Server state independently checks the exact query and result click.

Retrieval ends only after all three source facts are returned. Page scanning stops at the same requested facts, not at arbitrary complete-page coverage.

MCP/companion startup and tab preparation are excluded. Retrieval and whole search/click/retrieve workflow are measured separately.

Mode order rotates and reverses across paired rounds. One warm browser and native worker are reused; no failed input is replayed.

Range excerpts concern accessible provider text; they are not complete page coverage or a full-document version. No AI inference is measured.

Live Bing: not requested or not verified.
