import {z} from 'zod';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import type {WindowsRequest} from './automation.js';
import {serialize} from '../utils/timing.js';

const singleLine = (limit: number) => z.string().min(1).max(limit).refine((value) => [...value].every((char) => char.charCodeAt(0) >= 32), 'Use a single-line name.');
const version = z.string().regex(/^[a-f0-9]{64}$/);
export function excelBounds(address: string): {rows: number; columns: number; count: number} | undefined {
	const match = /^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})(?::\$?([A-Z]{1,3})\$?([1-9]\d{0,6}))?$/i.exec(address);
	if (!match) {
		return undefined;
	}

	const column = (letters: string) => [...letters.toUpperCase()].reduce((result, char) => (result * 26) + char.charCodeAt(0) - 64, 0);
	const firstRow = Number(match[2]);
	const lastRow = Number(match[4] ?? match[2]);
	const firstColumn = column(match[1]!);
	const lastColumn = column(match[3] ?? match[1]!);
	const rows = lastRow - firstRow + 1;
	const columns = lastColumn - firstColumn + 1;
	if (lastRow > 1048576 || lastColumn > 16384 || rows < 1 || columns < 1 || rows * columns > 1000) {
		return undefined;
	}

	return {rows, columns, count: rows * columns};
}

const range = z.string().max(30).refine((value) => Boolean(excelBounds(value)), 'Use a rectangular A1 range within Excel bounds, at most 1,000 cells.').transform((value) => value.replaceAll('$', '').toUpperCase());
const common = {
	window_id: z.string().regex(/^[1-9]\d{0,18}$/),
	timeout_ms: z.number().int().min(1).max(15000).default(5000),
	max_chars: z.number().int().min(2000).max(16000).default(8000),
};
const workbook = {workbook_name: singleLine(260).describe('Exact workbook name returned by inspect_workbook; checked against the requested native Excel window.')};
const target = {
	...common, ...workbook, sheet: singleLine(31), range,
};
const paging = {
	offset: z.number().int().min(0).max(1000).default(0),
	page_size: z.number().int().min(1).max(100).default(100),
	cell_chars: z.number().int().min(16).max(32767).default(1024),
	version: version.optional(),
};
export const excelSchema = z.discriminatedUnion('action', [
	z.object({action: z.literal('inspect_workbook'), ...common}).strict(),
	z.object({action: z.literal('read_range'), ...target, ...paging}).strict(),
	z.object({
		action: z.literal('find_cells'), ...target, ...paging,
		query: z.string().min(1).max(256), match: z.enum(['contains', 'exact']).default('contains'),
		look_in: z.enum(['values', 'formulas']).default('values'), case_sensitive: z.boolean().default(false),
	}).strict(),
	z.object({
		action: z.literal('write_range'), ...target,
		data: z.array(z.array(z.union([z.string().max(32767), z.number(), z.boolean(), z.null()])).min(1).max(1000)).min(1).max(1000),
		mode: z.enum(['values', 'formulas']).default('values'),
		require_empty: z.boolean().default(true), expected_version: version.optional(),
	}).strict(),
	z.object({action: z.literal('select_range'), ...target}).strict(),
	z.object({
		action: z.literal('save_workbook'), ...common, ...workbook, expected_path: singleLine(4096).describe('Exact full_name from inspection. Only existing writable workbook paths are supported.'),
	}).strict(),
]).superRefine((args, ctx) => {
	if ((args.action === 'read_range' || args.action === 'find_cells') && args.offset > 0 && !args.version) {
		ctx.addIssue({code: 'custom', path: ['version'], message: 'Subsequent pages require the original version.'});
	}

	if (args.action !== 'write_range') {
		return;
	}

	const bounds = excelBounds(args.range)!;
	if (args.data.length !== bounds.rows || args.data.some((row) => row.length !== bounds.columns)) {
		ctx.addIssue({code: 'custom', path: ['data'], message: 'Data dimensions must exactly match the target range.'});
	}

	if (!args.require_empty && !args.expected_version) {
		ctx.addIssue({code: 'custom', path: ['expected_version'], message: 'Overwriting requires the version from a fresh range read.'});
	}

	if (args.data.flat().reduce<number>((count, value) => count + (typeof value === 'string' ? value.length : 0), 0) > 150000) {
		ctx.addIssue({code: 'custom', path: ['data'], message: 'Write text payload must not exceed 150,000 characters.'});
	}

	if (args.mode === 'formulas' && args.data.some((row) => row.some((value) => typeof value !== 'string' || !value.startsWith('=') || value.length > 8192))) {
		ctx.addIssue({code: 'custom', path: ['data'], message: 'Formula mode requires English A1 formulas starting with =, at most 8,192 characters per cell.'});
	}
});
export type ExcelRequest = z.infer<typeof excelSchema>;
const compact = (data: Record<string, unknown>): CallToolResult => ({content: [{type: 'text', text: serialize(data)}], ...(data.ok === false ? {isError: true} : {})});

function clipCellField(out: Record<string, unknown>, cell: Record<string, unknown>, field: string, budget: number): void {
	const text = cell[field];
	if (typeof text !== 'string' || serialize(out).length <= budget) {
		return;
	}

	cell[`${field}_clipped`] = true;
	out.response_truncated = true;
	let low = 0;
	let high = text.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		cell[field] = text.slice(0, middle);
		if (serialize(out).length <= budget) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}

	if (low && /[\uD800-\uDBFF]/.test(text[low - 1]!)) {
		low -= 1;
	}

	cell[field] = text.slice(0, low);
}

/** Bound whole-cell pages; never skip a match or silently lose clipped cell contents. */
export function excelResult(data: Record<string, unknown>, maxChars: number): CallToolResult {
	const out = structuredClone(data);
	if (Array.isArray(out.cells)) {
		const cells = out.cells as Record<string, unknown>[];
		while (cells.length > 1 && serialize(out).length > maxChars) {
			cells.pop();
			out.response_truncated = true;
			out.has_more = true;
			out.next_offset = Number(cells.at(-1)!.offset) + 1;
		}

		const cell = cells[0];
		if (cell) {
			for (const field of ['formula', 'value']) {
				clipCellField(out, cell, field, maxChars);
			}
		}
	}

	if (Array.isArray(out.sheets)) {
		while (out.sheets.length && serialize(out).length > maxChars) {
			out.sheets.pop();
			out.sheets_truncated = true;
			out.response_truncated = true;
		}
	}

	if (serialize(out).length > maxChars) {
		return compact({
			ok: false, action: out.action, input_state: out.input_state, native_calls: out.native_calls,
			error: 'Response metadata exceeds the budget. Increase max_chars; no input was replayed.',
		});
	}

	return compact(out);
}

export async function runExcel(runtime: PokemonRuntime, input: unknown, signal?: AbortSignal): Promise<CallToolResult> {
	const args = excelSchema.parse(input);
	return runtime.computerBatch(async (perform) => {
		const deadline = performance.now() + args.timeout_ms;
		let inputState = 'not_sent';
		let calls = 0;
		const mutation = ['write_range', 'select_range', 'save_workbook'].includes(args.action);
		try {
			let result: Record<string, unknown> = {};
			const label = args.action === 'write_range' ? 'set_value' : args.action === 'select_range' ? 'select' : args.action === 'save_workbook' ? 'save_workbook' : 'get_ui_text';
			await perform(label, async () => {
				if (performance.now() >= deadline) {
					throw new Error('Excel operation timed out before native execution.');
				}

				calls += 1;
				if (mutation) {
					inputState = 'unknown';
				}

				result = await runtime.windows.request({...args, action: `excel_${args.action}`, max_chars: 1500000} as WindowsRequest, {
					signal, timeoutMs: Math.max(1, deadline - performance.now()), paused: () => runtime.companion.state.paused,
					timeoutError: 'Excel operation timed out. Input may have applied; inspect the workbook before continuing.',
				});
				if (['not_sent', 'applied', 'unknown'].includes(String(result.input_state))) {
					inputState = String(result.input_state);
				} else if (result.ok === true && mutation) {
					inputState = 'applied';
				}

				if (typeof result.ok !== 'boolean') {
					throw new Error('Invalid native Excel result. Inspect the workbook before continuing.');
				}

				if (result.ok && mutation && result.verified !== true) {
					throw new Error('Native Excel action did not confirm verification. Inspect before continuing.');
				}

				if (result.ok && (args.action === 'read_range' || args.action === 'find_cells')) {
					const bounds = excelBounds(args.range)!;
					if (!Array.isArray(result.cells) || result.total_cells !== bounds.count || result.range !== args.range || result.offset !== args.offset
						|| typeof result.has_more !== 'boolean' || !version.safeParse(result.version).success
						|| (result.has_more && (typeof result.next_offset !== 'number' || result.next_offset <= args.offset || result.next_offset > bounds.count))) {
						throw new Error('Incomplete native Excel page. Read the range again before continuing.');
					}
				}

				return compact({ok: true});
			});
			return excelResult({
				action: args.action, window_id: args.window_id, input_state: inputState, native_calls: calls,
				...('workbook_name' in args ? {workbook_name: args.workbook_name} : {}), ...('sheet' in args ? {sheet: args.sheet} : {}), ...result,
			}, args.max_chars);
		} catch (error) {
			return compact({
				ok: false, action: args.action, phase: 'native_request', input_state: inputState, native_calls: calls,
				error: (error instanceof Error ? error.message : String(error)).slice(0, 400),
			});
		}
	}, signal);
}
