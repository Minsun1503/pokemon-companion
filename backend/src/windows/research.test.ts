import {
	afterEach, describe, expect, it, vi,
} from 'vitest';
import {createHash} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {PokemonRuntime} from '../pokemon/runtime.js';
import type {Companion, PokemonState} from '../pokemon/companion.js';
import {researchResult, researchSchema, runResearch} from './research.js';
import {registerResearch} from '../tools/research.js';
import {rejectedAction, nativeFailure} from '../utils/errors.js';
import {instrument} from '../learning/instrument.js';

afterEach(() => {
	vi.restoreAllMocks();
});
const parse = (result: CallToolResult) => JSON.parse(result.content.find((item) => item.type === 'text')!.text);
const base = {window_id: '123', window_ref: 'b'.repeat(32), document_name: 'Research'};
const excerpt = (text: string) => ({
	found: true, text, method: 'native_range', scope: 'first_accessible_match',
	excerpt_sha256: createHash('sha256').update(text, 'utf16le').digest('hex'), source_truncated: false, full_document_version: false,
});
function fixture() {
	const companion: Companion = {
		state: {
			pet: 'pikachu', activity: 'idle', message: '', task: '', visible: false, paused: false, completedActions: 0,
		},
		async start() {/* No overlay in unit tests. */},
		async close() {/* No external process. */},
		async capture() {/* Retrieval never captures screenshots. */},
		async update(patch: Partial<PokemonState>) {
			Object.assign(this.state, patch);
		},
	};
	const runtime = new PokemonRuntime(companion);
	vi.spyOn(runtime.windows, 'withControlLease').mockImplementation(async (run) => run());
	const state = {
		complete: true, truncated: false, nodes: [{
			id: 7, name: 'Research', role: 'Document', targetable: true, actions: ['read_text'],
		}],
	};
	const request = vi.spyOn(runtime.windows, 'request').mockImplementation(async (args) => {
		if (args.action === 'get_ui') {
			return {...state, snapshot: 'a'.repeat(32)};
		}

		if (args.action === 'find_text_range') {
			return excerpt(`Evidence: ${args.text}`);
		}

		if (args.action === 'find_text_ranges') {
			return {results: args.queries!.map((query) => excerpt(`Evidence: ${query}`)), all_queries_returned: true, atomic_document_snapshot: false};
		}

		throw new Error(`Unexpected action: ${args.action}`);
	});
	return {runtime, request, state};
}

describe('research retrieval', () => {
	it('retrieves ordered passages in one native search and preserves the existing window identity', async () => {
		const {runtime, request} = fixture();
		const result = parse(await runResearch(runtime, {action: 'find_many', ...base, queries: ['second', 'first', 'second']}));
		expect(result).toMatchObject({
			ok: true, input_state: 'not_sent', native_calls: 2, requested_queries: 3,
			all_queries_returned: true, atomic_document_snapshot: false,
		});
		expect(result.results.map((row: {text: string}) => row.text)).toEqual(['Evidence: second', 'Evidence: first', 'Evidence: second']);
		expect(request.mock.calls.map(([args]) => args.action)).toEqual(['get_ui', 'find_text_ranges']);
		expect(request.mock.calls[0]![0]).toMatchObject({window_id: '123', window_ref: base.window_ref, control_type: 'Document'});
		expect(request.mock.calls[1]![0]).toMatchObject({snapshot: 'a'.repeat(32), element_id: 7, queries: ['second', 'first', 'second']});
	});

	it('does not reuse document text or observations across calls', async () => {
		const {runtime, request} = fixture();
		await runResearch(runtime, {action: 'find_text', ...base, query: 'first'});
		await runResearch(runtime, {action: 'find_text', ...base, query: 'second'});
		expect(request.mock.calls.map(([args]) => args.action)).toEqual(['get_ui', 'find_text_range', 'get_ui', 'find_text_range']);
	});

	it.each(['incomplete', 'truncated', 'ambiguous', 'missing', 'wrong_role', 'untargetable', 'unreadable'])('rejects %s Documents before searching', async (kind) => {
		const {runtime, request, state} = fixture();
		if (kind === 'incomplete') {
			state.complete = false;
		}

		if (kind === 'truncated') {
			state.truncated = true;
		}

		if (kind === 'ambiguous') {
			state.nodes.push({...state.nodes[0]!, id: 8});
		}

		if (kind === 'missing') {
			state.nodes = [];
		}

		if (kind === 'wrong_role') {
			state.nodes[0]!.role = 'Edit';
		}

		if (kind === 'untargetable') {
			state.nodes[0]!.targetable = false;
		}

		if (kind === 'unreadable') {
			state.nodes[0]!.actions = [];
		}

		const result = await runResearch(runtime, {action: 'find_text', ...base, query: 'fact'});
		expect(result.isError).toBe(true);
		expect(parse(result)).toMatchObject({ok: false, input_state: 'not_sent', phase: 'document_discovery'});
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('preserves native stale-target rejection and never retries the range lookup', async () => {
		const {runtime, request} = fixture();
		const dispatch = request.getMockImplementation()!;
		request.mockImplementation(async (args, options) => {
			if (args.action === 'find_text_range') {
				throw rejectedAction('STALE_REF', 'Document was replaced.');
			}

			return dispatch(args, options);
		});
		expect(parse(await runResearch(runtime, {action: 'find_text', ...base, query: 'fact'}))).toMatchObject({
			ok: false, phase: 'range_search', native_calls: 2, error_details: {code: 'STALE_REF', disposition: {delivery: 'not_delivered'}},
		});
		expect(request).toHaveBeenCalledTimes(2);
	});

	it.each(['pause', 'cancel'])('stops on %s between discovery and retrieval', async (kind) => {
		const {runtime, request} = fixture();
		const controller = new AbortController();
		const dispatch = request.getMockImplementation()!;
		request.mockImplementation(async (args, options) => {
			const result = await dispatch(args, options);
			if (kind === 'pause') {
				runtime.companion.state.paused = true;
			} else {
				controller.abort();
			}

			return result;
		});
		expect(parse(await runResearch(runtime, {
			action: 'find_many', ...base, queries: ['fact'], timeout_ms: 300,
		}, controller.signal))).toMatchObject({
			ok: false, input_state: 'not_sent', error_details: {code: kind === 'pause' ? 'PAUSED' : 'CANCELLED'},
		});
		expect(request).toHaveBeenCalledTimes(1);
		expect(request.mock.calls[0]![1]!.timeoutMs).toBeLessThanOrEqual(300);
		expect(request.mock.calls[0]![1]!.signal).toBe(controller.signal);
	});

	it('holds the runtime lease across discovery and retrieval', async () => {
		const {runtime, request} = fixture();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const dispatch = request.getMockImplementation()!;
		request.mockImplementationOnce(async (args, options) => {
			await gate;
			return dispatch(args, options);
		});
		const reading = runResearch(runtime, {action: 'find_many', ...base, queries: ['fact']});
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
	});

	it('reports negative matches and bounded fallback without claiming full-page absence', async () => {
		const {runtime, request} = fixture();
		const dispatch = request.getMockImplementation()!;
		request.mockImplementation(async (args, options) => args.action === 'find_text_range'
			? {
				...excerpt(''), found: false, method: 'bounded_full_text_fallback', source_truncated: true,
			}
			: dispatch(args, options));
		expect(parse(await runResearch(runtime, {action: 'find_text', ...base, query: 'absent'}))).toMatchObject({
			ok: true, found: false, method: 'bounded_full_text_fallback', source_truncated: true, full_document_version: false,
		});
	});

	it('classifies both internal native range operations as reads', () => {
		for (const action of ['find_text_range', 'find_text_ranges']) {
			expect(nativeFailure('ACTION_FAILED', 'provider stopped', action).details.disposition).toEqual({delivery: 'not_delivered', retry: 'safe'});
		}
	});

	it('validates query limits and strict action fields before touching the desktop', async () => {
		const {runtime, request} = fixture();
		for (const queries of [[], Array.from({length: 9}, () => 'x'), [''], ['x'.repeat(201)]]) {
			expect(researchSchema.safeParse({action: 'find_many', ...base, queries}).success).toBe(false);
		}

		await expect(runResearch(runtime, {
			action: 'find_many', ...base, queries: ['x'], query: 'extra',
		})).rejects.toThrow();
		expect(request).not.toHaveBeenCalled();
	});
});

describe('research response budget', () => {
	it('clips escaped excerpts fairly while preserving result count, Unicode and returned-text hashes', () => {
		const result = researchResult({ok: true, results: [excerpt(('"\\\n🐱').repeat(500)), excerpt('second '.repeat(500))]}, 1000);
		const data = parse(result);
		expect(result.isError).toBeUndefined();
		expect(result.content.find((item) => item.type === 'text')!.text.length).toBeLessThanOrEqual(1000);
		expect(data.response_truncated).toBe(true);
		expect(data.results).toHaveLength(2);
		for (const row of data.results) {
			expect(row.text.length).toBeGreaterThan(0);
			expect(row.excerpt_truncated).toBe(true);
			expect(row.text).not.toMatch(/[\uD800-\uDBFF]$/);
			expect(row.excerpt_sha256).toBe(createHash('sha256').update(row.text, 'utf16le').digest('hex'));
		}
	});

	it('reports insufficient metadata budget without quietly dropping results', () => {
		const result = researchResult({ok: true, results: Array.from({length: 8}, () => excerpt('x'.repeat(2000)))}, 1000);
		expect(result.isError).toBe(true);
		expect(parse(result)).toMatchObject({
			ok: false, requested_queries: 8, results_returned: 0, error_details: {code: 'OUTPUT_BUDGET'},
		});
		expect(result.content.find((item) => item.type === 'text')!.text.length).toBeLessThanOrEqual(1000);
	});
});

describe.runIf(process.platform === 'win32')('research MCP registration', () => {
	it('exposes find_many through an actual MCP client and strict schema exchange', async () => {
		const {runtime} = fixture();
		const server = new McpServer({name: 'test', version: '1'});
		const enter = vi.spyOn(runtime.learning, 'enter').mockResolvedValue();
		const record = vi.spyOn(runtime.learning, 'record').mockResolvedValue();
		vi.spyOn(runtime.learning, 'leave').mockImplementation(() => undefined);
		registerResearch(instrument(server, runtime.learning), runtime);
		const client = new Client({name: 'test', version: '1'});
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
		try {
			expect((await client.listTools()).tools[0]!.annotations?.readOnlyHint).toBe(true);
			const taskId = '00000000-0000-4000-8000-000000000001';
			const result = await client.callTool({
				name: 'research', arguments: {
					action: 'find_many', ...base, queries: ['one', 'two'], task_id: taskId,
				},
			});
			expect(parse(result as CallToolResult)).toMatchObject({ok: true, results: [{text: 'Evidence: one'}, {text: 'Evidence: two'}]});
			expect(enter).toHaveBeenCalledWith(taskId);
			expect(record).toHaveBeenCalledTimes(1);
		} finally {
			await client.close();
			await server.close();
		}
	});
});
