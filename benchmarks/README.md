# Windows MCP benchmarks

Build the project, then run the atomic versus batch benchmark in a Windows desktop session:

```powershell
npm run build
npm run benchmark:windows -- --runs 20 --output benchmarks/results/windows-batch-2026-11-07.json
```

The script launches a uniquely named disposable test window and a real Pokémon overlay, using isolated application data. It compares the same six Windows API steps through six atomic MCP calls versus one batch call: find the window, find the field, fill it, find the button, invoke it, and read the field. It independently checks the field and button count after every workflow and fails if any operation is incorrect or returns a screenshot image.

Fresh-worker observations use separate MCP processes. Warm measurements use a single persistent worker, one warmup per mode, and alternating order across paired runs. The default is 20 runs per mode; `--runs` accepts 5–100. JSON contains every recorded sample, startup measurements, median/p95/min/max/mean execution times, request/result character and UTF-8 byte counts, and hashes of the built backend files. A Markdown report is generated alongside it. Output paths are relative to the project root unless absolute.

The timer includes Windows APIs, MCP stdio transport, parsing, and companion updates. Connection, overlay launch, and independent HTTP verification are measured separately or excluded. This benchmark uses no AI inference, so it measures neither end-to-end model latency nor actual tokens/dollars. Fewer MCP calls and smaller responses support lower orchestration overhead, but results for this small accessibility tree do not predict every application.

Recorded run: [November 7, 2026 report](results/windows-batch-2026-11-07.md) and [raw samples](results/windows-batch-2026-11-07.json).
