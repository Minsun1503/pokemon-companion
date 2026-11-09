import {
	afterEach, describe, expect, it, vi,
} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {PokemonRuntime} from '../pokemon/runtime.js';
import type {Companion, PokemonState} from '../pokemon/companion.js';
import {
	excelBounds, excelResult, excelSchema, runExcel,
} from './excel.js';
import {registerExcel} from '../tools/excel.js';

afterEach(() => vi.restoreAllMocks());
const parse = (result: CallToolResult): Record<string, any> => JSON.parse(result.content.find((item) => item.type === 'text')!.text);
const base = {
	window_id: '123', workbook_name: 'Fixture.xlsx', sheet: 'Data', range: 'A1:B2',
};
const hash = 'a'.repeat(64);
function fixture() {
	const companion: Companion = {
		state: {
			pet: 'pikachu', activity: 'idle', message: '', task: '', visible: false, paused: false, completedActions: 0,
		},
		async start() {/* No overlay in unit tests. */},
		async close() {/* No external process. */},
		async capture() {
			throw new Error('Excel operations must not capture screenshots.');
		},
		async update(patch: Partial<PokemonState>) {
			Object.assign(this.state, patch);
		},
	};
	const runtime = new PokemonRuntime(companion);
	const request = vi.spyOn(runtime.windows, 'request').mockResolvedValue({
		ok: true, cells: [{
			offset: 0, address: 'A1', value: '00123', formula: null,
		}], range: 'A1:B2',
		offset: 0, next_offset: 1, has_more: true, total_cells: 4, version: hash,
	});
	return {runtime, companion, request};
}

describe('desktop Excel request validation', () => {
	it.each(['A0', 'XFE1', 'A1048577', 'B2:A1', 'A:A', 'Data!A1', 'NamedRange', 'A1,B2', 'A1:A1001', 'A$$1', 'A$B1', 'A1$'])('refuses unsafe or unbounded range %s', (range) => {
		expect(excelBounds(range)).toBeUndefined();
		expect(excelSchema.safeParse({action: 'read_range', ...base, range}).success).toBe(false);
	});
	it('accepts Excel boundary cells, rectangular bounds and absolute addresses', () => {
		expect(excelBounds('$XFD$1048576')).toEqual({rows: 1, columns: 1, count: 1});
		expect(excelBounds('b2:d3')).toEqual({rows: 2, columns: 3, count: 6});
		const parsed = excelSchema.parse({action: 'read_range', ...base, range: '$a$1:$b$2'});
		expect(parsed.action === 'read_range' && parsed.range).toBe('A1:B2');
	});
	it('rejects shape mismatches, ragged rows, unsafe overwrites and invalid formulas before desktop access', async () => {
		const {runtime, request} = fixture();
		for (const data of [[[1]], [[1, 2], [3]], [[1, 2], [3, 4], [5, 6]]]) {
			expect(excelSchema.safeParse({action: 'write_range', ...base, data}).success).toBe(false);
		}

		expect(excelSchema.safeParse({
			action: 'write_range', ...base, data: [[1, 2], [3, 4]], require_empty: false,
		}).success).toBe(false);
		expect(excelSchema.safeParse({
			action: 'write_range', ...base, data: [['=SUM(A1)', 'literal'], ['=1', '=2']], mode: 'formulas',
		}).success).toBe(false);
		await expect(runExcel(runtime, {action: 'write_range', ...base, data: [[1]]})).rejects.toThrow();
		expect(request).not.toHaveBeenCalled();
	});
	it('requires original page versions and limits write transport size', () => {
		expect(excelSchema.safeParse({
			action: 'find_cells', ...base, offset: 1, query: 'test',
		}).success).toBe(false);
		expect(excelSchema.safeParse({
			action: 'write_range', ...base, range: 'A1:F1', data: [Array(6).fill('x'.repeat(32767))],
		}).success).toBe(false);
	});
});

describe('Excel response budgets', () => {
	it('resumes finding after the last transmitted match, including matches skipped by the native scan', () => {
		const data = {
			ok: true, offset: 0, has_more: false, next_offset: null, total_cells: 1000, version: hash,
			cells: [10, 400, 900].map((offset) => ({
				offset, address: `A${offset + 1}`, value: '"\n'.repeat(2000), formula: null,
			})),
		};
		const response = excelResult(data, 2000);
		const page = parse(response);
		expect(response.content).toHaveLength(1);
		expect((response.content[0] as {text: string}).text.length).toBeLessThanOrEqual(2000);
		expect(page.cells).toHaveLength(1);
		expect(page.next_offset).toBe(11);
		expect(page.has_more).toBe(true);
		expect(page.cells[0].value_clipped).toBe(true);
		expect(page.response_truncated).toBe(true);
	});
	it('keeps blank, zero, false and formulas distinguishable in bounded output', () => {
		const cells = [null, 0, false, '=literal'].map((value, offset) => ({
			offset, address: `A${offset + 1}`, value, formula: offset === 1 ? '=SUM(B1:B2)' : null,
		}));
		expect(parse(excelResult({ok: true, cells}, 2000)).cells).toEqual(cells);
	});
	it('reports clipped formula/value text without inventing an intra-cell cursor', () => {
		const response = excelResult({
			ok: true, offset: 0, next_offset: null, has_more: false,
			cells: [{
				offset: 0, address: 'A1', value: '🐱'.repeat(4000), formula: `="${'x'.repeat(4000)}"`,
			}],
		}, 2000);
		const page = parse(response);
		expect(page.has_more).toBe(false);
		expect(page.next_offset).toBeNull();
		expect(page.cells[0].value_clipped).toBe(true);
		expect(page.cells[0].formula_clipped).toBe(true);
		expect(String(page.cells[0].value)).not.toMatch(/[\uD800-\uDBFF]$/);
	});
	it('does not truncate workbook identity to fit the budget', () => {
		const response = excelResult({
			ok: true, input_state: 'not_sent', full_name: 'x'.repeat(3000), sheets: [{name: 'Data'}],
		}, 2000);
		expect(response.isError).toBe(true);
		expect(parse(response).error).toContain('metadata');
	});
});

describe('serialized native Excel operations', () => {
	it('reads through one native call and preserves explicit target provenance', async () => {
		const {runtime, request} = fixture();
		const response = await runExcel(runtime, {action: 'read_range', ...base});
		expect(parse(response)).toMatchObject({
			ok: true, workbook_name: 'Fixture.xlsx', sheet: 'Data', native_calls: 1, input_state: 'not_sent',
		});
		expect(request).toHaveBeenCalledTimes(1);
		expect(request.mock.calls[0]![0]).toMatchObject({
			action: 'excel_read_range', window_id: '123', workbook_name: 'Fixture.xlsx', range: 'A1:B2',
		});
		expect(response).not.toHaveProperty('structuredContent');
	});
	it('retains native preflight diagnostics when nothing was sent', async () => {
		const {runtime, request} = fixture();
		request.mockResolvedValue({
			ok: false, phase: 'range_preflight', input_state: 'not_sent', error: 'Worksheet is protected',
		});
		expect(parse(await runExcel(runtime, {action: 'write_range', ...base, data: [[1, 2], [3, 4]]}))).toMatchObject({ok: false, input_state: 'not_sent', phase: 'range_preflight'});
		expect(request).toHaveBeenCalledTimes(1);
	});
	it('reports uncertain input on native failure without retrying', async () => {
		const {runtime, request} = fixture();
		request.mockRejectedValue(new Error('Excel stopped responding'));
		expect(parse(await runExcel(runtime, {action: 'write_range', ...base, data: [[1, 2], [3, 4]]}))).toMatchObject({ok: false, input_state: 'unknown', native_calls: 1});
		expect(request).toHaveBeenCalledTimes(1);
	});
	it('does not accept an incomplete page or an unverified mutation', async () => {
		const {runtime, request} = fixture();
		request.mockResolvedValue({ok: true});
		expect(parse(await runExcel(runtime, {action: 'read_range', ...base})).ok).toBe(false);
		expect(parse(await runExcel(runtime, {action: 'select_range', ...base}))).toMatchObject({ok: false, input_state: 'applied'});
	});
	it.each(['pause', 'cancel'])('stops before native execution on %s', async (mode) => {
		const {runtime, companion, request} = fixture();
		const controller = new AbortController();
		if (mode === 'pause') {
			companion.state.paused = true;
		} else {
			controller.abort();
		}

		expect(parse(await runExcel(runtime, {action: 'read_range', ...base}, controller.signal))).toMatchObject({ok: false, input_state: 'not_sent', native_calls: 0});
		expect(request).not.toHaveBeenCalled();
	});
	it('passes bounded deadlines and serializes the whole native operation', async () => {
		const {runtime, request} = fixture();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const result = request.getMockImplementation();
		request.mockImplementationOnce(async (...args) => {
			await gate;
			return result!(...args);
		});
		const reading = runExcel(runtime, {action: 'read_range', ...base, timeout_ms: 1000});
		let otherRan = false;
		const other = runtime.exclusive(async () => {
			otherRan = true;
		});
		await Promise.resolve();
		expect(otherRan).toBe(false);
		release();
		await reading;
		await other;
		expect(otherRan).toBe(true);
		expect(request.mock.calls[0]![1]!.timeoutMs).toBeLessThanOrEqual(1000);
	});
});

describe.runIf(process.platform === 'win32')('Excel MCP registration', () => {
	it('exposes the Excel schema through a real MCP exchange', async () => {
		const {runtime} = fixture();
		const server = new McpServer({name: 'test', version: '1'});
		registerExcel(server, runtime);
		const client = new Client({name: 'test', version: '1'});
		const [ct, st] = InMemoryTransport.createLinkedPair();
		await Promise.all([server.connect(st), client.connect(ct)]);
		try {
			expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['excel']);
			const response = await client.callTool({name: 'excel', arguments: {action: 'read_range', ...base}});
			expect(parse(response as CallToolResult).ok).toBe(true);
		} finally {
			await client.close();
			await server.close();
		}
	});
});
