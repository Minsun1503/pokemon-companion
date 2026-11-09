import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import {excelSchema, runExcel} from '../windows/excel.js';
import {timedCall} from '../utils/timing.js';

export function registerExcel(server: McpServer, runtime: PokemonRuntime): void {
	if (process.platform !== 'win32') {
		return;
	}

	server.registerTool('excel', {
		title: 'Desktop Excel Operations',
		description: 'Focused Windows Excel native-object-model operations: inspect_workbook, read_range, find_cells, write_range, select_range, save_workbook. Start with windows get_windows to choose an Excel window_id, then inspect_workbook to obtain exact workbook/sheet names and path. Every later action checks that workbook name against the chosen window; no active-workbook guessing or new Excel instance. Reads/finds use bounded rectangular A1 ranges (at most 1000 cells), row-major offset/next_offset pages and original version on subsequent pages. value_clipped/formula_clipped mean incomplete fields; raise cell_chars/max_chars to read more. Writes default to empty targets; overwriting requires require_empty=false and expected_version from a fresh read of the same range. Value-mode strings stay literal, including leading zeros and equals signs; formula mode requires English A1 formulas. Writes verify stored contents but do not save automatically. Save requires exact expected_path from inspection and an existing writable path; no Save As. Protected View, read-only/protected writes, merged/array/spill writes and hidden-sheet selection are unsupported. Operations share the action queue, respect user pauses/cancellation, never retry input, and report input_state not_sent/applied/unknown on failure. Use current user authorisation for edits/saves; Excel event handlers can run. No screenshots, explicit macro commands, add-in installation, or security-setting changes.',
		inputSchema: excelSchema, annotations: {readOnlyHint: false},
	}, async (args, extra) => timedCall('excel', args.action, async () => runExcel(runtime, args, extra.signal)));
}
