import {
	afterEach, describe, expect, it, vi,
} from 'vitest';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {PokemonRuntime} from '../pokemon/runtime.js';
import type {Companion, PokemonState} from '../pokemon/companion.js';
import {courseSchema, runCourse} from './course.js';
import {registerCourse} from '../tools/course.js';
import type {WindowsRequest} from './automation.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});
const parse = (r: CallToolResult) => JSON.parse(r.content.find((c) => c.type === 'text')!.text);
const base = {window_id: '123', document_name: 'Lesson'};
const oldVersion = 'a'.repeat(64);
const newVersion = 'b'.repeat(64);
function fixture() {
	const companion: Companion = {
		state: {
			pet: 'pikachu', activity: 'idle', message: '', task: '', visible: true, paused: false, completedActions: 0,
		},
		async start() {/* No overlay needed in unit tests. */},
		async close() {/* No external process to close. */},
		async update(patch: Partial<PokemonState>) {
			Object.assign(this.state, patch);
		},
		async capture() {/* These helpers must never capture the desktop. */},
	};
	const runtime = new PokemonRuntime(companion);
	vi.spyOn(runtime.windows, 'withControlLease').mockImplementation(async (run) => run());
	const state = {
		text: 'Old lesson', version: oldVersion, search: '', navigated: false, staleReads: 0,
		duplicate: '', truncated: false, sourceTruncated: false, nextText: 'New lesson READY CHAPTER TWO',
	};
	const request = vi.spyOn(runtime.windows, 'request').mockImplementation(async (args: WindowsRequest) => {
		if (args.action === 'get_ui') {
			const role = args.control_type!;
			const nodes: Record<string, unknown>[] = role === 'Document'
				? [{
					id: 1, name: 'Lesson', role, actions: ['read_text'],
				}]
				: role === 'Edit'
					? [{
						id: 2, name: 'Address and search bar', role, value: 'https://example.com', actions: ['set_value'],
					},
					{
						id: 3, name: 'Search', role, value: state.search, actions: ['set_value'],
					}]
					: [{
						id: 4, name: 'Next lesson', role, actions: [role === 'TabItem' ? 'select' : 'invoke'],
					}];
			if (state.duplicate === role) {
				nodes.push({...nodes.at(-1)!, id: 5});
			}

			return {
				window: {id: '123'}, snapshot: 'a'.repeat(32), nodes, matched: nodes.length, truncated: state.truncated,
			};
		}

		if (args.action === 'invoke' || args.action === 'select' || args.action === 'set_value') {
			state.navigated = true;
			if (args.action === 'set_value') {
				state.search = args.text!;
			}

			return {ok: true};
		}

		if (args.action === 'read_text_page') {
			const {staleReads} = state;
			state.staleReads -= 1;
			if (state.navigated && staleReads <= 0) {
				state.text = state.nextText;
				state.version = newVersion;
			}

			if (args.expected_version && args.expected_version !== state.version) {
				throw new Error('Lesson text changed');
			}

			const offset = args.text_offset ?? 0;
			const text = state.text.slice(offset, offset + (args.text_length ?? 100));
			const end = offset + text.length;
			const matches = args.required_text ? state.text.split(args.required_text).length - 1 : undefined;
			return {
				text, offset, next_offset: end < state.text.length ? end : null, has_more: end < state.text.length,
				total_characters: state.text.length, version: state.version, source_truncated: state.sourceTruncated,
				...(matches === undefined ? {} : {match_count: matches, match_excerpt: matches ? args.required_text : ''}),
			};
		}

		throw new Error(`Unexpected action ${args.action}`);
	});
	return {runtime, request, state};
}

describe('course reading helpers', () => {
	it('waits through stale navigation reads, invokes once and returns one verified page', async () => {
		const {runtime, request, state} = fixture();
		state.staleReads = 2;
		const result = await runCourse(runtime, {
			action: 'open_lesson', ...base, navigation_name: 'Next lesson', ready_text: 'READY CHAPTER TWO',
		});
		expect(parse(result)).toMatchObject({
			ok: true, input_state: 'applied', readiness_verified: true, version: newVersion, text: state.nextText,
		});
		expect(request.mock.calls.filter(([a]) => a.action === 'invoke')).toHaveLength(1);
		expect(result.content).toHaveLength(1);
		expect(result).not.toHaveProperty('structuredContent');
		expect(request.mock.calls.every(([a]) => !['key', 'get_screenshot'].includes(a.action))).toBe(true);
	});

	it('selects a named lesson tab through its selection pattern', async () => {
		const {runtime, request} = fixture();
		expect(parse(await runCourse(runtime, {
			action: 'open_lesson', ...base, navigation_name: 'Next lesson', navigation_role: 'TabItem', ready_text: 'READY CHAPTER TWO',
		})).ok).toBe(true);
		expect(request.mock.calls.filter(([a]) => a.action === 'select')).toHaveLength(1);
		expect(request.mock.calls.some(([a]) => a.action === 'invoke')).toBe(false);
	});

	it('disambiguates Search from the address bar and verifies the actual field', async () => {
		const {runtime, request} = fixture();
		const result = parse(await runCourse(runtime, {
			action: 'search_courses', ...base, search_text: 'Chapter two', ready_text: 'READY CHAPTER TWO',
		}));
		expect(result).toMatchObject({ok: true, readiness_verified: true, input_state: 'applied'});
		const sent = request.mock.calls.filter(([a]) => a.action === 'set_value');
		expect(sent).toHaveLength(1);
		expect(sent[0]![0]).toMatchObject({element_id: 3, text: 'Chapter two'});
	});

	it('does not re-enter an already verified query', async () => {
		const {runtime, request, state} = fixture();
		state.search = 'Chapter two';
		state.text = state.nextText;
		const result = parse(await runCourse(runtime, {
			action: 'search_courses', ...base, search_text: state.search, ready_text: 'READY CHAPTER TWO',
		}));
		expect(result).toMatchObject({ok: true, input_state: 'not_sent'});
		expect(request.mock.calls.some(([a]) => a.action === 'set_value')).toBe(false);
	});

	it.each(['Button', 'Document', 'Edit'])('refuses duplicate exact %s targets without mutating', async (role) => {
		const {runtime, request, state} = fixture();
		state.duplicate = role;
		const result = parse(await runCourse(runtime, role === 'Edit'
			? {
				action: 'search_courses', ...base, search_text: 'two', ready_text: 'READY CHAPTER TWO',
			}
			: {
				action: 'open_lesson', ...base, navigation_name: 'Next lesson', ready_text: 'READY CHAPTER TWO',
			}));
		expect(result).toMatchObject({ok: false, input_state: 'not_sent'});
		expect(result.error).toContain('Ambiguous');
		expect(request.mock.calls.some(([a]) => ['invoke', 'select', 'set_value'].includes(a.action))).toBe(false);
	});

	it('rejects truncated discovery before input', async () => {
		const {runtime, request, state} = fixture();
		state.truncated = true;
		expect(parse(await runCourse(runtime, {
			action: 'open_lesson', ...base, navigation_name: 'Next lesson', ready_text: 'READY CHAPTER TWO',
		})).error).toContain('truncated');
		expect(request.mock.calls.some(([a]) => a.action === 'invoke')).toBe(false);
	});

	it('reconstructs escaped long text from transmitted cursors within the total budget', async () => {
		const {runtime, state} = fixture();
		state.text = ('Vietnamese: chữ \\ quoted " text\n').repeat(600);
		let offset = 0;
		let reconstructed = '';
		let currentVersion: string | undefined;
		do {
			// Each page depends on the previous cursor/version.
			// eslint-disable-next-line no-await-in-loop
			const response = await runCourse(runtime, {
				action: 'read_lesson', ...base, offset, version: currentVersion, page_chars: 12000, max_chars: 1000,
			});
			const page = parse(response);
			expect(response.content[0]).toHaveProperty('type', 'text');
			expect((response.content[0] as {text: string}).text.length).toBeLessThanOrEqual(1000);
			expect(page.ok).toBe(true);
			expect(page.offset).toBe(offset);
			expect(page.text.length).toBeGreaterThan(0);
			reconstructed += String(page.text);
			currentVersion = page.version;
			if (!page.has_more) {
				break;
			}

			expect(page.next_offset).toBe(offset + String(page.text).length);
			offset = page.next_offset;
		} while (offset < state.text.length);

		expect(reconstructed).toBe(state.text);
		expect(reconstructed.length).toBeGreaterThan(8000);
	});

	it('preserves useful lesson text when a readiness excerpt also needs clipping', async () => {
		const {runtime, state} = fixture();
		const marker = '"'.repeat(200);
		state.nextText = '\n'.repeat(200) + marker + 'x'.repeat(10000);
		const response = await runCourse(runtime, {
			action: 'open_lesson', ...base, navigation_name: 'Next lesson', ready_text: marker,
			page_chars: 12000, max_chars: 1000,
		});
		const page = parse(response);
		expect((response.content[0] as {text: string}).text.length).toBeLessThanOrEqual(1000);
		expect(page.ok).toBe(true);
		expect(page.text.length).toBeGreaterThan(0);
		expect(page.next_offset).toBe(String(page.text).length);
		expect(page.response_truncated).toBe(true);
	});

	it('passes the original version to subsequent pages and rejects changed lessons', async () => {
		const {runtime, request, state} = fixture();
		state.text = 'x'.repeat(9000);
		const first = parse(await runCourse(runtime, {action: 'read_lesson', ...base}));
		state.version = newVersion;
		const second = parse(await runCourse(runtime, {
			action: 'read_lesson', ...base, offset: first.next_offset, version: first.version,
		}));
		expect(second).toMatchObject({ok: false, input_state: 'not_sent'});
		expect(second.error).toContain('changed');
		expect(request.mock.calls.at(-1)![0].expected_version).toBe(oldVersion);
	});

	it.each([[0, false, 'not_found'], [1, false, 'confirmed'], [2, false, 'ambiguous'], [1, true, 'unknown']])('reports completion evidence %j', async (count, truncated, status) => {
		const {runtime, state} = fixture();
		const marker = 'Congratulations course complete';
		state.text = (`${marker}\n`).repeat(Number(count));
		state.sourceTruncated = Boolean(truncated);
		expect(parse(await runCourse(runtime, {action: 'check_completion', ...base, completion_text: marker}))).toMatchObject({ok: true, status, match_count: count});
	});

	it('never treats a stale document as successful navigation', async () => {
		vi.useFakeTimers();
		const {runtime, request, state} = fixture();
		state.nextText = state.text;
		// Even an already-present marker must not satisfy an unchanged document version.
		state.text += ' READY CHAPTER TWO';
		state.nextText = state.text;
		state.staleReads = 100;
		const pending = runCourse(runtime, {
			action: 'open_lesson', ...base, navigation_name: 'Next lesson', ready_text: 'READY CHAPTER TWO', timeout_ms: 250,
		});
		await vi.advanceTimersByTimeAsync(300);
		expect(parse(await pending)).toMatchObject({ok: false, input_state: 'applied', phase: 'lesson_ready'});
		expect(request.mock.calls.filter(([a]) => a.action === 'invoke')).toHaveLength(1);
	});

	it('reports an uncertain native input outcome without replay', async () => {
		const {runtime, request} = fixture();
		const dispatch = request.getMockImplementation()!;
		request.mockImplementation(async (args, opts) => {
			if (args.action === 'invoke') {
				throw new Error('Provider disappeared during invoke');
			}

			return dispatch(args, opts);
		});
		expect(parse(await runCourse(runtime, {
			action: 'open_lesson', ...base, navigation_name: 'Next lesson', ready_text: 'READY CHAPTER TWO',
		}))).toMatchObject({ok: false, input_state: 'unknown'});
		expect(request.mock.calls.filter(([a]) => a.action === 'invoke')).toHaveLength(1);
	});

	it('refuses to confirm navigation when the readable source is capped', async () => {
		const {runtime, request, state} = fixture();
		state.sourceTruncated = true;
		expect(parse(await runCourse(runtime, {
			action: 'open_lesson', ...base, navigation_name: 'Next lesson', ready_text: 'READY CHAPTER TWO',
		}))).toMatchObject({ok: false, input_state: 'applied', phase: 'lesson_ready'});
		expect(request.mock.calls.filter(([a]) => a.action === 'invoke')).toHaveLength(1);
	});

	it.each(['pause', 'cancel'])('stops on %s before input and passes a bounded native deadline', async (mode) => {
		const {runtime, request} = fixture();
		const controller = new AbortController();
		const dispatch = request.getMockImplementation()!;
		request.mockImplementation(async (args, opts) => {
			const result = await dispatch(args, opts);
			if (mode === 'pause') {
				runtime.companion.state.paused = true;
			} else {
				controller.abort();
			}

			return result;
		});
		expect(parse(await runCourse(runtime, {action: 'read_lesson', ...base, timeout_ms: 300}, controller.signal))).toMatchObject({ok: false, input_state: 'not_sent'});
		expect(request).toHaveBeenCalledTimes(1);
		expect(request.mock.calls[0]![1]!.timeoutMs).toBeLessThanOrEqual(300);
		expect(request.mock.calls[0]![1]!.signal).toBe(controller.signal);
	});

	it('keeps the whole operation exclusive across clients', async () => {
		const {runtime, request} = fixture();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const dispatch = request.getMockImplementation()!;
		request.mockImplementationOnce(async (args, opts) => {
			await gate;
			return dispatch(args, opts);
		});
		const reading = runCourse(runtime, {action: 'read_lesson', ...base});
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

	it('validates the full request before any desktop access', async () => {
		const {runtime, request} = fixture();
		expect(courseSchema.safeParse({action: 'read_lesson', ...base, offset: 1}).success).toBe(false);
		expect(courseSchema.safeParse({action: 'check_completion', ...base, completion_text: 'Completed'}).success).toBe(false);
		await expect(runCourse(runtime, {action: 'submit_quiz', ...base})).rejects.toThrow();
		expect(request).not.toHaveBeenCalled();
	});
});

describe.runIf(process.platform === 'win32')('course MCP registration', () => {
	it('exposes the helpers through a real MCP schema/client exchange', async () => {
		const {runtime, request} = fixture();
		const server = new McpServer({name: 'test', version: '1'});
		registerCourse(server, runtime);
		const client = new Client({name: 'test', version: '1'});
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
		try {
			const tools = await client.listTools();
			expect(tools.tools.map((t) => t.name)).toEqual(['course']);
			const result = await client.callTool({name: 'course', arguments: {action: 'read_lesson', ...base}});
			expect(parse(result as CallToolResult)).toMatchObject({ok: true, text: 'Old lesson'});
			request.mockRejectedValueOnce(new Error('lost native read response'));
			const failed = await client.callTool({name: 'course', arguments: {action: 'read_lesson', ...base}});
			expect(parse(failed as CallToolResult)).toMatchObject({contract_version: 1, error_details: {disposition: {delivery: 'not_delivered', retry: 'safe'}}});
		} finally {
			await client.close();
			await server.close();
		}
	});
});
