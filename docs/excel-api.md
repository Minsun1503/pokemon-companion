# Desktop Excel API

The Windows-only `excel` MCP tool combines repeatable Excel operations into one native request through Pokémon Companion. It attaches to the selected Excel window's object model using `AccessibleObjectFromWindow` and COM; it does not open a new Excel instance, guess the active workbook, type into cells, or capture screenshots. Requires installed Windows desktop Excel with separate workbook windows (Excel 2013 or later).

Build, then reconnect the MCP server to expose the tool in Claude, Codex, or another local MCP client. Programmatic callers can import `excelSchema`, `runExcel(runtime, request, signal?)`, and the `ExcelRequest` type from `backend/dist/index.js`. Reuse and close your existing `PokemonRuntime`.

## Choose the workbook

Use `windows get_windows` with `query: "EXCEL"` to choose the returned workbook window. Then call:

```json
{"action":"inspect_workbook","window_id":"12345"}
```

This returns `workbook_name`, `full_name`, read-only/saved status, sheet names, visibility, protection, used ranges, and calculation settings. It lists worksheets, not chart sheets. All later actions require the **exact** `workbook_name`; range operations also require the exact `sheet` name. Both are checked against the requested native window. Example names below are placeholders, not selectors to guess.

## Core operations

| Action | Inputs beyond window/workbook | Result |
| --- | --- | --- |
| `read_range` | `sheet`, `range`, optional paging | Versioned cell values and formulas |
| `write_range` | `sheet`, `range`, rectangular `data`, `mode` | One bulk write, stored-content verification, new version |
| `find_cells` | `sheet`, bounded `range`, `query`, optional match/paging | Matching addresses, values, and formulas |
| `select_range` | `sheet`, `range` | Activate the exact workbook window/sheet, select, and verify |
| `save_workbook` | `expected_path` | Save an existing writable workbook and verify Excel's saved state |

### Read values and formulas

```json
{"action":"read_range","window_id":"12345","workbook_name":"Products.xlsx","sheet":"Data","range":"A1:D20","page_size":50,"max_chars":8000}
```

Each `cells` entry contains its zero-based row-major `offset`, `address`, native `value`, and `formula` (null for constants). Blank cells are null, distinct from zero and false. Strings retain their content, including leading zeros, Unicode, and literal equals signs. Dates are Excel `Value2` serial numbers; the API does not infer date formats, dates, units, or business meanings. Excel error values return an object with `error` and `error_code`. Formula text uses Excel's English A1 `Formula` representation, rather than locale-specific or `Formula2` syntax.

Results include `version`, `total_cells`, `has_more`, and `next_offset`. Continue with the returned `next_offset` and the first page's `version`, using the same workbook, sheet, and range. Later pages require that version. A changed value or formula fails rather than mixing different range states. Versions hash the full native contents, including content shortened in the response; they do not cover formatting.

`value_clipped` or `formula_clipped` means that particular field is incomplete. Increase `cell_chars` and `max_chars`, and reduce `page_size` or the range to read more. These flags are different from `has_more`, which only describes remaining cells. Cell text has no intra-cell cursor: text larger than a single response budget cannot be delivered in full through this API. A shortened field is never marked complete.

### Write literal values

```json
{"action":"write_range","window_id":"12345","workbook_name":"Products.xlsx","sheet":"Data","range":"A2:C3","data":[["00123","=literal",7],["chữ 🐱",null,0]]}
```

Default `mode: "values"` preserves strings as literal text. Values such as `"00123"` and `"=literal"` are not converted to numbers or formulas. Use JSON numbers, booleans, strings, or null for blank cells; dimensions must exactly match the target range. Existing formatting is retained. This writes through `Value2` once, then reads back and verifies values and the absence of unintended formulas. It does not save automatically.

Targets must be empty by default. To replace existing contents, read the **same range**, then send `require_empty: false` with its `expected_version`:

```json
{"action":"write_range","window_id":"12345","workbook_name":"Products.xlsx","sheet":"Data","range":"A2:C3","data":[["00999","text",8],["updated",null,0]],"require_empty":false,"expected_version":"<version returned by read_range>"}
```

### Write formulas

```json
{"action":"write_range","window_id":"12345","workbook_name":"Products.xlsx","sheet":"Data","range":"D2:D3","mode":"formulas","data":[["=SUM(B2:C2)"],["=SUM(B3:C3)"]]}
```

Every formula-mode entry must start with `=` and use English A1 syntax. Verification concerns stored formula text, not correctness of your business calculation or successful evaluation. Excel may normalize some formulas; a mismatch returns an error with input already applied. Inspect before continuing. Formula results follow Excel's calculation mode; `calculation_state` is reported and manual calculation is not silently changed. Formula dependencies, normal Excel event handlers, and external references may have effects beyond the target cells.

### Find cells

```json
{"action":"find_cells","window_id":"12345","workbook_name":"Products.xlsx","sheet":"Data","range":"A1:D100","query":"00123","match":"exact"}
```

Default matching is case-insensitive `contains`; use `match: "exact"`, `case_sensitive: true`, or `look_in: "formulas"` when needed. Search stays inside the supplied range and compares native values using invariant text conversion, not formatted display text. Formula searches exclude literal strings beginning with `=`. It uses the same versioned cursor rules as reading. If the response budget removes trailing matches, the next cursor resumes after the last match actually delivered, so omitted matches can still be found. A no-match result establishes absence only within this bounded range.

### Select and save

```json
{"action":"select_range","window_id":"12345","workbook_name":"Products.xlsx","sheet":"Data","range":"B2:D20"}
{"action":"save_workbook","window_id":"12345","workbook_name":"Products.xlsx","expected_path":"C:\\Work\\Products.xlsx"}
```

Selection activates the exact workbook window and verifies the workbook, sheet, and selection. Hidden sheets are not unhidden automatically. Saving requires the exact `full_name` from inspection and a writable workbook already saved to a path. Unsaved workbooks and Save As are unsupported, so this API cannot choose a new file path or dismiss an overwrite dialog. Save covers the workbook's current edits, and its `saved: true` result reflects Excel's own saved state. The smoke test also verifies disk persistence by reopening the saved workbook.

## Limits and recovery

- Each request is exclusive with other actions sharing the runtime, respects pauses/cancellation, and has a native execution budget of up to 15 seconds (default 5 seconds). Queue wait and companion feedback can add latency. Human input and Excel calculations are not locked by the queue; version checks are preconditions, not transactions.
- Ranges are single rectangular A1 areas, at most 1,000 cells, within `A1:XFD1048576`. Whole columns, named ranges, multiple areas, and sheet-qualified addresses are unsupported. Split larger work into explicit ranges.
- `page_size`: 1–100, default 100. `cell_chars`: 16–32,767, default 1,024. Native transport may reduce the page size for large cells. `max_chars`: 2,000–16,000, default 8,000, including JSON metadata. Always use returned cursors.
- Write strings: at most 32,767 characters per cell and 150,000 in the whole request. Formulas: at most 8,192 per cell.
- Protected View, the start screen, non-Excel windows, blocked dialogs, and Excel Online are rejected. Read-only or protected-sheet writes and writes involving merged cells, existing array formulas, or spill ranges are rejected. Protection, macros, add-ins, prompts, and application security settings are not changed.
- Failures report `phase`, `native_calls`, and `input_state`: `not_sent`, `applied`, or `unknown`. Native failures before mutation use `not_sent`; an interrupted/timed-out native request may have applied input even after the client stopped waiting. Inspect the workbook before continuing. Inputs are never retried or rolled back automatically.
- Clipped fields and sheet listings are explicit. Workbook identity/path is never shortened to fit a response; an insufficient metadata budget produces an error instead.

## Verification

Run `npm run test:excel` after building on an unlocked Windows desktop with Excel installed. It creates an owned Excel application with two disposable local workbooks and exercises all six APIs through a real MCP client. It checks targeting while another workbook is active, literal text, leading zeros, Unicode, null/zero/false, bulk writes and read-back, versioned paging, stale versions, formulas, error cells, finding, protection/merged-cell rejection, exact selection, and saving followed by reopening. It closes only its owned workbooks/application and removes its temporary files. No screenshots or user workbooks are used.

Backend tests cover invalid ranges and write shapes, required versions, response clipping/cursors, preservation of typed values, cancellation/pauses, uncertain inputs, and runtime isolation. Formatting, sorting/filtering, charts, pivot tables, and file-opening workflows can be added as separate focused operations later.
