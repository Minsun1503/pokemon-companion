import {
	describe, expect, it, vi,
} from 'vitest';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {Companion, PokemonState} from '../pokemon/companion.js';
import {PokemonRuntime} from '../pokemon/runtime.js';
import {registerWindows} from '../tools/windows.js';
import {jsonResult} from '../utils/response.js';
import {runWindowsBatch, windowsStepSchema} from './batch.js';

const snapshot = 'a'.repeat(32);
const listed = {windows: [{id: '123', title: 'Test'}]};
const control = {
	window: {id: '123'}, snapshot, matched: 1, truncated: false, nodes: [{
		id: 1, role: 'Edit', value: '', actions: ['set_value'],
	}],
};
const plan = [
	{action: 'get_windows', query: 'Test'},
	{
		action: 'get_ui', window_step: 0, query: 'Note', control_type: 'Edit',
	},
	{action: 'set_value', target_step: 1, text: 'Hello'},
	{
		action: 'get_ui', window_step: 0, query: 'Note', expect_value: 'Hello',
	},
];
const steps = (input: unknown = plan) => windowsStepSchema.array().parse(input);
const parse = (result: CallToolResult) => JSON.parse(result.content.find((item) => item.type === 'text')!.text) as Record<string, any>;

function fixture() {
	const companion: Companion = {
		state: {
			pet: 'pikachu', activity: 'idle', message: '', task: '', visible: true, paused: false, completedActions: 0,
		},
		async start() {
			return undefined;
		},
		async close() {
			return undefined;
		},
		async update(patch: Partial<PokemonState>) {
			Object.assign(this.state, patch);
		},
		capture: vi.fn(async () => undefined),
	};
	const runtime = new PokemonRuntime(companion);
	const request = vi.spyOn(runtime.windows, 'request')
		.mockResolvedValueOnce(structuredClone(listed))
		.mockResolvedValueOnce(structuredClone(control))
		.mockResolvedValueOnce({ok: true, value: 'Hello'})
		.mockResolvedValueOnce({...structuredClone(control), nodes: [{...control.nodes[0], value: 'Hello'}]});
	return {runtime, companion, request};
}

describe('Windows batch execution', () => {
	it('resolves discovered ids, verifies a value and returns only the final result', async () => {
		const {runtime, companion, request} = fixture();
		const result = await runWindowsBatch(runtime, steps(), 2000);
		expect(result.isError).not.toBe(true);
		expect(parse(result)).toMatchObject({
			ok: true, completed: 4, total: 4, result_step: 3, result: {nodes: [{value: 'Hello'}]},
		});
		expect(parse(result)).not.toHaveProperty('results');
		expect(result).not.toHaveProperty('structuredContent');
		expect(result.content[0]).toMatchObject({type: 'text', text: JSON.stringify(parse(result))});
		expect(request.mock.calls[1]![0].window_id).toBe('123');
		expect(request.mock.calls[2]![0]).toMatchObject({
			action: 'set_value', snapshot, element_id: 1, text: 'Hello',
		});
		expect(request.mock.calls[2]![0]).not.toHaveProperty('target_step');
		expect(request.mock.calls[3]![0]).not.toHaveProperty('expect_value');
		expect(companion.state.completedActions).toBe(4);
		expect(companion.capture).not.toHaveBeenCalled();
	});

	it.each([
		{...control, matched: 0, nodes: []},
		{...control, matched: 2, nodes: [...control.nodes, {...control.nodes[0], id: 2}]},
		{...control, truncated: true},
		{...control, nodes: [{...control.nodes[0], actions: ['focus']}]},
	])('stops before input when a control is missing, ambiguous, truncated or unsupported: %j', async (discovery) => {
		const {runtime, request} = fixture();
		request.mockReset().mockResolvedValueOnce(listed).mockResolvedValueOnce(discovery);
		const result = await runWindowsBatch(runtime, steps(), 2000);
		expect(result.isError).toBe(true);
		expect(parse(result)).toMatchObject({
			completed: 2, stopped_step: 2, failed_step_started: false, result_step: 1, result: discovery,
		});
		expect(request).toHaveBeenCalledTimes(2);
	});

	it.each([{windows: []}, {windows: [...listed.windows, {id: '456'}]}, {...listed, truncated: true}])('requires a unique complete window lookup: %j', async (discovery) => {
		const {runtime, request} = fixture();
		request.mockReset().mockResolvedValueOnce(discovery);
		const result = await runWindowsBatch(runtime, steps(), 2000);
		expect(parse(result)).toMatchObject({completed: 1, stopped_step: 1, result_step: 0});
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('reports partial failure without retrying an input or executing later steps', async () => {
		const {runtime, request} = fixture();
		request.mockReset().mockResolvedValueOnce(listed).mockResolvedValueOnce(control).mockRejectedValueOnce(new Error('Native invocation failed'));
		const result = await runWindowsBatch(runtime, steps(), 2000);
		expect(parse(result)).toMatchObject({
			completed: 2, stopped_step: 2, failed_step_started: true, error: 'Native invocation failed',
		});
		expect(request).toHaveBeenCalledTimes(3);
	});

	it('stops on a failed expectation and retains the observed value', async () => {
		const {runtime, request} = fixture();
		request.mockReset().mockResolvedValueOnce(listed).mockResolvedValueOnce(control).mockResolvedValueOnce({ok: true}).mockResolvedValue(control);
		const result = await runWindowsBatch(runtime, steps([...plan, {action: 'activate', window_step: 0}]), 2000);
		expect(parse(result)).toMatchObject({
			completed: 3, stopped_step: 3, result_step: 3, result: {nodes: [{value: ''}]},
		});
		expect(request).toHaveBeenCalledTimes(5);
	});

	it('rechecks a stale expected value without replaying the completed input', async () => {
		const {runtime, request} = fixture();
		request.mockReset().mockResolvedValueOnce(listed).mockResolvedValueOnce(control).mockResolvedValueOnce({ok: true})
			.mockResolvedValueOnce(control).mockResolvedValueOnce({...control, nodes: [{...control.nodes[0], value: 'Hello'}]});
		const result = await runWindowsBatch(runtime, steps(), 2000);
		expect(parse(result)).toMatchObject({ok: true, completed: 4, result: {nodes: [{value: 'Hello'}]}});
		expect(request.mock.calls.filter(([args]) => args.action === 'set_value')).toHaveLength(1);
		expect(request).toHaveBeenCalledTimes(5);
	});

	it.each(['pause', 'cancel'])('honors %s before rechecking a stale value', async (reason) => {
		const {runtime, companion, request} = fixture();
		const controller = new AbortController();
		request.mockReset().mockResolvedValueOnce(listed).mockResolvedValueOnce(control).mockResolvedValueOnce({ok: true})
			.mockImplementationOnce(async () => {
				if (reason === 'pause') {
					companion.state.paused = true;
				} else {
					controller.abort();
				}

				return control;
			});
		const result = await runWindowsBatch(runtime, steps(), 2000, controller.signal);
		expect(parse(result)).toMatchObject({completed: 3, stopped_step: 3, error: 'Computer action cancelled or paused before execution.'});
		expect(request).toHaveBeenCalledTimes(4);
	});

	it.each(['pause', 'cancel'])('honors %s between steps', async (reason) => {
		const {runtime, companion, request} = fixture();
		const controller = new AbortController();
		request.mockReset().mockImplementationOnce(async () => {
			if (reason === 'pause') {
				companion.state.paused = true;
			} else {
				controller.abort();
			}

			return listed;
		});
		const result = await runWindowsBatch(runtime, steps(), 2000, controller.signal);
		expect(parse(result)).toMatchObject({completed: 1, stopped_step: 1, failed_step_started: false});
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('prevalidates a malformed later step before doing any work', async () => {
		const {runtime, request} = fixture();
		await expect(runWindowsBatch(runtime, steps([...plan, {action: 'set_value', target_step: 1}]), 2000)).rejects.toThrow('requires text');
		await expect(runWindowsBatch(runtime, steps([{action: 'get_ui', window_step: 1}, {action: 'get_windows'}]), 2000)).rejects.toThrow('earlier');
		await expect(runWindowsBatch(runtime, steps([...plan, {action: 'invoke', target_step: 0}]), 2000)).rejects.toThrow('earlier get_ui');
		expect(request).not.toHaveBeenCalled();
	});

	it('prevents another client from interleaving input within a batch', async () => {
		const {runtime, request} = fixture();
		const events: string[] = [];
		let release: () => void = () => undefined;
		let started: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const entered = new Promise<void>((resolve) => {
			started = resolve;
		});
		request.mockReset().mockImplementation(async (args) => {
			events.push(args.action);
			if (events.length === 1) {
				started();
				await gate;
			}

			return listed;
		});
		const batch = runWindowsBatch(runtime, steps([{action: 'get_windows'}, {action: 'get_windows'}]), 2000);
		await entered;
		const other = runtime.computer('type', undefined, async () => {
			events.push('other input');
			return jsonResult({ok: true});
		});
		release();
		await Promise.all([batch, other]);
		expect(events).toEqual(['get_windows', 'get_windows', 'other input']);
	});

	it('bounds failure diagnostics and successful text without changing saved discovery', async () => {
		const {runtime, request} = fixture();
		const discovery = {...control, truncated: true, nodes: [{...control.nodes[0], value: 'x'.repeat(10000)}]};
		request.mockReset().mockResolvedValueOnce(listed).mockResolvedValueOnce(discovery);
		const result = await runWindowsBatch(runtime, steps(), 1000);
		expect(JSON.stringify(parse(result)).length).toBeLessThanOrEqual(1000);
		expect(result.content.find((item) => item.type === 'text')!.text.length).toBeLessThanOrEqual(1000);
		expect(parse(result).truncated).toBe(true);
		expect(discovery.nodes).toHaveLength(1);
		request.mockReset().mockResolvedValueOnce({text: '\n'.repeat(8000)});
		const text = await runWindowsBatch(runtime, steps([{action: 'read_text', snapshot, element_id: 1}]), 1000);
		expect(JSON.stringify(parse(text)).length).toBeLessThanOrEqual(1000);
		expect(text.content.find((item) => item.type === 'text')!.text.length).toBeLessThanOrEqual(1000);
		expect(parse(text).truncated).toBe(true);
		request.mockReset().mockRejectedValueOnce(new Error('\u0000'.repeat(400)));
		const failure = await runWindowsBatch(runtime, steps([{action: 'get_windows'}]), 1000);
		expect(failure.isError).toBe(true);
		expect(JSON.stringify(parse(failure)).length).toBeLessThanOrEqual(1000);
		expect(failure.content.find((item) => item.type === 'text')!.text.length).toBeLessThanOrEqual(1000);
		expect(parse(failure).truncated).toBe(true);
	});

	it('supports element ref format @s<snapshot>:e<element_id> (Credit: Vercel agent-desktop)', async () => {
		const {runtime, request} = fixture();
		request.mockReset().mockResolvedValueOnce({ok: true});
		const result = await runWindowsBatch(runtime, steps([{action: 'invoke', ref: `@s${snapshot}:e1`}]), 2000);
		expect(result.isError).not.toBe(true);
		expect(request).toHaveBeenCalledWith(expect.objectContaining({
			action: 'invoke', snapshot, element_id: 1,
		}));
	});

	it.runIf(process.platform === 'win32')('exposes batches through MCP while preserving atomic calls and validating size', async () => {
		const {runtime, request} = fixture();
		const server = new McpServer({name: 'batch-test', version: '1'});
		registerWindows(server, runtime);
		const client = new Client({name: 'test', version: '1'});
		const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		try {
			const batch = await client.callTool({name: 'windows', arguments: {action: 'batch', steps: plan, max_chars: 2000}});
			expect(parse(batch as CallToolResult)).toMatchObject({ok: true, completed: 4});
			request.mockResolvedValueOnce(listed);
			const atomic = await client.callTool({name: 'windows', arguments: {action: 'get_windows', query: 'Test'}});
			expect(parse(atomic as CallToolResult)).toEqual(listed);
			await Promise.all([[], Array.from({length: 17}, () => ({action: 'get_windows'})), [{action: 'batch'}]].map(async (input) => {
				const result = await client.callTool({name: 'windows', arguments: {action: 'batch', steps: input}});
				expect(result.isError).toBe(true);
			}));
		} finally {
			await client.close();
			await server.close();
		}
	});
});
