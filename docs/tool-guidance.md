# Shared MCP guidance budget

The shared initialization guidance was shortened while retaining instructions for user authorization, pauses, task attribution, target identity, verification, private data, and safe retries. A regression test exercises actual MCP initialization and caps the guidance at 3,500 UTF-8 bytes.

## Measurements

The baseline is checkout `65ca05a44e488b8cbb9afeb95e0c2d9a17956714`. The comparison uses the same in-memory MCP connection and catalog serialization for both versions.

| Metric | Baseline | After |
| --- | ---: | ---: |
| Shared instruction characters / UTF-8 bytes | 6,163 | 3,406 |
| Serialized tool catalog UTF-8 bytes | 29,939 | 29,337 |
| Shared characters expanded across eight tools by the observed client | 49,296 | 27,240 |

Shared guidance decreased by **44.7%**. The observed eight-tool expansion removes 22,056 repeated characters. The catalog measurement excludes initialization instructions; it is a separate measurement, not the expanded client size.

The tool schemas and annotations have the same SHA-256 hash before and after: `0623c3be0ca96d843c767ac46b261ca29583f957a7f7fe25930e98d6d6ce802e`. This hash excludes descriptions and does not prove unchanged model behavior.

Machine-readable evidence: [baseline](../benchmarks/results/tool-guidance-baseline-2026-11-13.json) and [after](../benchmarks/results/tool-guidance-after-2026-11-13.json).

## Reproduce

From the source checkout, install dependencies using the normal setup procedure, then run:

```sh
npm run build --prefix backend
npm run benchmark:tool-guidance
npm run check
npm test
```

To save another measurement, run `npm run benchmark:tool-guidance -- --output <new-json-path>`. The parent directory must exist; the command refuses to overwrite an existing file. The benchmark connects to the built backend through `InMemoryTransport`; it sends no computer input and does not start the companion.

Validation for this change: build and static checks passed; 394 tests passed and one was skipped. The new initialization test protects the size budget. Existing tests continue to exercise the implementation's behavior.

## Limits

These are character and byte counts, not tokenizer counts. Client expansion projects how the observed eight-tool client exposes initialization instructions; other clients can differ. No controlled model-selection comparison or end-to-end latency improvement was measured. The native worker is unchanged.

The server already supplies shared initialization instructions. Moving the same prose there would not address the observed client's duplication. A connected MCP process retains its loaded instructions until it is restarted and the client reconnects; measuring a freshly built server does not reload a live client.
