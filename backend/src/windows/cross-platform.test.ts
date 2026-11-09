import {
	describe, expect, it, vi,
} from 'vitest';
import {CrossPlatformAutomation, DesktopCommandError, type DesktopExecutor} from './cross-platform.js';
import {
	validateWindowsRequest, windowsStepSchema, runWindowsBatch, runWindowsRequest,
} from './batch.js';
import type {WindowsRequest, RequestOptions} from './automation.js';
import type {PokemonRuntime} from '../pokemon/runtime.js';

const window = {
	id: 'w-calculator', title: 'Calculator', app_name: 'gnome-calculator', is_focused: true,
};
const nativeRef = '@s26u7pv9qta5g4:e6';
const disposition = {delivery: 'delivered_unverified', retry: 'unsafe'};
const reply = (command: string, data: unknown, exitCode = 0) => ({
	stdout: JSON.stringify({
		version: '2.6', ok: true, command, data,
	}), exitCode,
});
const tree = () => ({
	window, snapshot_id: 's26u7pv9qta5g4', complete: true,
	tree: {
		role: 'window', name: 'Calculator', children: [{
			role: 'textfield', name: 'Note', value: '', native_id: {kind: 'ax_identifier', value: 'note_field'},
			ref_id: nativeRef, available_actions: ['Click', 'SetFocus', 'SetValue', 'Toggle', 'Expand', 'Collapse', 'Scroll', 'Select'],
		}],
	},
});
const inspect: WindowsRequest = {
	action: 'get_ui', window_id: window.id, query: 'note', control_type: 'Edit',
};
const options = (patch: Partial<RequestOptions> = {}): RequestOptions => ({
	timeoutMs: 500, paused: () => false, timeoutError: 'test deadline', ...patch,
});
function fixture(platform = 'linux') {
	let time = 1000;
	const execute = vi.fn<DesktopExecutor>().mockImplementation(async (args) => {
		if (args[0] === 'snapshot') {
			return reply('snapshot', tree());
		}

		if (args[0] === 'list-windows') {
			return reply('list-windows', [window]);
		}

		return reply(args[0]!, {action: args[0], disposition});
	});
	const bridge = new CrossPlatformAutomation(execute, platform, () => time);
	return {
		execute, bridge, advance(ms: number) {
			time += ms;
		},
	};
}

const target = (result: Record<string, unknown>, action = 'invoke'): WindowsRequest => ({action, snapshot: String(result.snapshot), element_id: 1});

describe.each(['linux', 'darwin'])('agent-desktop 2.6 bridge on %s (contract fixtures)', (platform) => {
	it('reads the array envelope and filters window titles/processes locally', async () => {
		const {bridge, execute} = fixture(platform);
		expect(await bridge.request({action: 'get_windows', query: 'GNOME'})).toMatchObject({windows: [{...window, process: 'gnome-calculator', active: true}]});
		expect(execute.mock.calls[0]![0]).toEqual(['list-windows', '--timeout-ms', '20000']);
		expect(await bridge.request({action: 'get_windows', query: 'absent'})).toEqual({windows: []});
	});

	it('creates valid local snapshots and maps local queries to exact native refs', async () => {
		const {bridge, execute} = fixture(platform);
		const result = await bridge.request({...inspect, query: 'FIELD'});
		expect(result.snapshot).toMatch(/^[a-f0-9]{32}$/);
		expect(result).toMatchObject({matched: 1, truncated: false, nodes: [{id: 1, role: 'Edit', automation_id: 'note_field'}]});
		expect(execute.mock.calls[0]![0]).toEqual(['snapshot', '--window-id', window.id, '--max-depth', '24', '--timeout-ms', '20000']);
		const request = {...target(result), ref: `@s${String(result.snapshot)}:e1`};
		validateWindowsRequest(request);
		expect(request).not.toHaveProperty('ref');
		expect(await bridge.request(request)).toMatchObject({ok: true, disposition});
		expect(execute.mock.calls[1]![0]).toEqual(['click', nativeRef, '--timeout-ms', '20000']);
	});

	it('keeps separate snapshots mapped to their original refs', async () => {
		const {bridge, execute} = fixture(platform);
		const first = await bridge.request(inspect);
		const secondTree = tree();
		secondTree.snapshot_id = 'snew';
		secondTree.tree.children[0]!.ref_id = '@snew:e82';
		execute.mockResolvedValueOnce(reply('snapshot', secondTree));
		const second = await bridge.request(inspect);
		await bridge.request(target(first));
		await bridge.request(target(second));
		expect(execute.mock.calls.slice(-2).map(([args]) => args[1])).toEqual([nativeRef, '@snew:e82']);
	});

	it.each(['', 'Hello\nworld\n', 'Pokémon Xin chào!'])('sends values through stdin without exposing text in arguments: %j', async (text) => {
		const {bridge, execute} = fixture(platform);
		const result = await bridge.request(inspect);
		await bridge.request({...target(result, 'set_value'), text});
		expect(execute.mock.calls[1]![0]).toEqual(['set-value', nativeRef, '--stdin', '--timeout-ms', '20000']);
		expect(execute.mock.calls[1]![2]).toBe(text);
	});

	it.each([['focus', 'focus'], ['toggle', 'toggle'], ['expand', 'expand'], ['collapse', 'collapse'], ['scroll', 'scroll']])('maps %s to its documented command', async (action, command) => {
		const {bridge, execute} = fixture(platform);
		const result = await bridge.request(inspect);
		await bridge.request({...target(result, action), direction: 'down'});
		expect(execute.mock.calls[1]![0]).toEqual([command, nativeRef, ...(action === 'scroll' ? ['--direction', 'down'] : []), '--timeout-ms', '20000']);
	});

	it('uses focus-window and rejects an unexpected focused window', async () => {
		const {bridge, execute} = fixture(platform);
		execute.mockResolvedValueOnce(reply('focus-window', {focused: window}));
		expect(await bridge.request({action: 'activate', window_id: window.id})).toMatchObject({focused: window});
		expect(execute.mock.calls[0]![0]).toEqual(['focus-window', '--window-id', window.id]);
		execute.mockResolvedValueOnce(reply('focus-window', {focused: {...window, id: 'another'}}));
		await expect(bridge.request({action: 'activate', window_id: window.id})).rejects.toThrow('another window');
	});

	it('reads text through get and explains its saved-text limitation', async () => {
		const {bridge, execute} = fixture(platform);
		const result = await bridge.request(inspect);
		execute.mockResolvedValueOnce(reply('get', {property: 'text', ref: nativeRef, value: 'long\ntext'}));
		expect(await bridge.request(target(result, 'read_text'))).toMatchObject({text: 'long\ntext', source: expect.stringContaining('saved snapshot')});
		expect(execute.mock.calls[1]![0]).toEqual(['get', nativeRef, '--property', 'text']);
	});

	it('propagates structured action failures and never retries or falls back', async () => {
		const {bridge, execute} = fixture(platform);
		const result = await bridge.request(inspect);
		const error = {code: 'POLICY_DENIED', message: 'Headed input is required', disposition: {delivery: 'not_delivered', retry: 'safe'}};
		execute.mockResolvedValueOnce({
			stdout: JSON.stringify({
				version: '2.6', command: 'click', ok: false, error,
			}), exitCode: 1,
		});
		const failure = await bridge.request(target(result)).catch((caught: unknown) => caught);
		expect(failure).toBeInstanceOf(DesktopCommandError);
		expect((failure as DesktopCommandError).details).toEqual(error);
		expect(execute).toHaveBeenCalledTimes(2);
	});

	it('marks partial snapshots and clipped values so they cannot prove exact matches', async () => {
		const {bridge, execute} = fixture(platform);
		const partial = {
			...tree(), complete: false, truncated: true, identity_unproven: true,
		};
		partial.tree.children[0]!.value = 'x'.repeat(200);
		execute.mockResolvedValueOnce(reply('snapshot', partial));
		expect(await bridge.request(inspect)).toMatchObject({truncated: true, identity_unproven: true, nodes: [{value: 'x'.repeat(160), value_clipped: true}]});
	});

	it('hides protected subtrees and removes disabled actions', async () => {
		const {bridge, execute} = fixture(platform);
		const disabled = tree();
		Object.assign(disabled.tree.children[0]!, {states: ['disabled']});
		execute.mockResolvedValueOnce(reply('snapshot', disabled));
		const result = await bridge.request(inspect);
		expect(result).toMatchObject({nodes: [{enabled: false, actions: []}]});
		await expect(bridge.request(target(result))).rejects.toThrow('does not support');
		Object.assign(disabled.tree, {states: ['protected']});
		execute.mockResolvedValueOnce(reply('snapshot', disabled));
		expect(await bridge.request(inspect)).toMatchObject({nodes: [], matched: 0});
	});

	it('rejects expired, foreign-window, missing and evicted targets before delivery', async () => {
		const {bridge, execute, advance} = fixture(platform);
		const first = await bridge.request(inspect);
		await expect(bridge.request({...target(first), window_id: 'other'})).rejects.toThrow('another window');
		await expect(bridge.request({...target(first), element_id: 50})).rejects.toThrow('absent');
		expect(execute).toHaveBeenCalledTimes(1);
		advance(120_000);
		await expect(bridge.request(target(first))).rejects.toThrow('expired');
		const evicted = await bridge.request(inspect);
		for (let index = 0; index < 8; index++) {
			// eslint-disable-next-line no-await-in-loop
			await bridge.request(inspect);
		}

		await expect(bridge.request(target(evicted))).rejects.toThrow('expired');
		bridge.close();
		await expect(bridge.request(target(evicted))).rejects.toThrow('expired');
	});

	it('rejects unsupported controls, missing values and directions before delivery', async () => {
		const {bridge, execute} = fixture(platform);
		const result = await bridge.request(inspect);
		await expect(bridge.request(target(result, 'select'))).rejects.toThrow('does not support');
		await expect(bridge.request(target(result, 'set_value'))).rejects.toThrow('requires text');
		await expect(bridge.request(target(result, 'scroll'))).rejects.toThrow('requires direction');
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it('accepts process launch without a window and rejects unsupported URL/path launch', async () => {
		const {bridge, execute} = fixture(platform);
		execute.mockResolvedValueOnce(reply('launch', {app: 'Calculator', pid: 123, process_instance: 'boot:1'}));
		expect(await bridge.request({action: 'launch', text: 'Calculator'})).toMatchObject({started: 'Calculator', query: 'Calculator'});
		expect(execute.mock.calls[0]![0]).toEqual(['launch', 'Calculator', '--timeout', '20000']);
		await expect(bridge.request({action: 'launch', text: 'https://example.com'})).rejects.toThrow('application name only');
		await expect(bridge.request({action: 'launch', text: '/usr/bin/calculator'})).rejects.toThrow('application name only');
		expect(execute).toHaveBeenCalledTimes(1);
	});
});

describe('bridge validation and interruption', () => {
	it.each([
		'not json',
		{
			version: '2.5', ok: true, command: 'list-windows', data: [],
		},
		{
			version: '2.6', ok: true, command: 'list-windows', data: {windows: []},
		},
		{version: '2.6', ok: false, command: 'list-windows'},
		{
			version: '2.6', ok: true, command: 'snapshot', data: [],
		},
	])('rejects incompatible or malformed envelopes: %j', async (raw) => {
		const {bridge, execute} = fixture();
		execute.mockResolvedValueOnce({stdout: typeof raw === 'string' ? raw : JSON.stringify(raw), exitCode: 0});
		await expect(bridge.request({action: 'get_windows'})).rejects.toThrow();
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it('rejects empty action results instead of inventing success', async () => {
		const {bridge, execute} = fixture();
		const result = await bridge.request(inspect);
		execute.mockResolvedValueOnce(reply('click', {}));
		await expect(bridge.request(target(result))).rejects.toThrow();
		execute.mockResolvedValueOnce(reply('click', {action: 'click', disposition}, 1));
		await expect(bridge.request(target(result))).rejects.toThrow('invalid success');
	});

	it('bounds large native action details while retaining disposition', async () => {
		const {bridge, execute} = fixture();
		const result = await bridge.request(inspect);
		execute.mockResolvedValueOnce(reply('click', {action: 'click', disposition, post_state: {value: 'x'.repeat(20_000)}}));
		const report = await bridge.request({...target(result), max_chars: 1000});
		expect(report).toMatchObject({
			ok: true, disposition, truncated: true, details_omitted: true,
		});
		expect(JSON.stringify(report).length).toBeLessThanOrEqual(1000);
	});

	it('rejects foreign snapshot windows and refs', async () => {
		const {bridge, execute} = fixture();
		execute.mockResolvedValueOnce(reply('snapshot', {...tree(), window: {...window, id: 'other'}}));
		await expect(bridge.request(inspect)).rejects.toThrow('another window');
		const invalid = tree();
		invalid.tree.children[0]!.ref_id = '@sother:e1';
		execute.mockResolvedValueOnce(reply('snapshot', invalid));
		await expect(bridge.request(inspect)).rejects.toThrow('another snapshot');
	});

	it('fails clearly on unavailable CLI or unsupported OS', async () => {
		const {bridge, execute} = fixture();
		execute.mockRejectedValueOnce(new Error('agent-desktop unavailable'));
		await expect(bridge.request({action: 'get_windows'})).rejects.toThrow('unavailable');
		await expect(new CrossPlatformAutomation(execute, 'freebsd').request({action: 'get_windows'})).rejects.toThrow('Unsupported desktop platform');
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it('prevents delivery when cancelled or paused before execution', async () => {
		const {bridge, execute} = fixture();
		const controller = new AbortController();
		controller.abort();
		await expect(bridge.request({action: 'get_windows'}, options({signal: controller.signal}))).rejects.toThrow('cancelled');
		await expect(bridge.request({action: 'get_windows'}, options({paused: () => true}))).rejects.toThrow('paused');
		expect(execute).not.toHaveBeenCalled();
	});

	it.each(['cancel', 'pause', 'timeout'])('bounds in-flight execution and invalidates refs after %s', async (kind) => {
		const {bridge, execute} = fixture();
		const result = await bridge.request(inspect);
		const controller = new AbortController();
		let paused = false;
		execute.mockImplementationOnce(async () => new Promise(() => {/* Deliberately stalled executor. */}));
		const pending = bridge.request(target(result), options({signal: controller.signal, paused: () => paused, timeoutMs: kind === 'timeout' ? 10 : 500}));
		if (kind === 'cancel') {
			controller.abort();
		}

		if (kind === 'pause') {
			paused = true;
		}

		await expect(pending).rejects.toThrow(kind === 'cancel' ? 'cancelled' : kind === 'pause' ? 'paused' : 'test deadline');
		expect(execute.mock.calls[1]![1].aborted).toBe(true);
		await expect(bridge.request(target(result))).rejects.toThrow('expired');
		expect(execute).toHaveBeenCalledTimes(2);
	});

	it('stops pending execution when the automation instance closes', async () => {
		const {bridge, execute} = fixture();
		execute.mockImplementationOnce(async () => new Promise(() => {/* Stalled process. */}));
		const pending = bridge.request({action: 'get_windows'});
		bridge.close();
		await expect(pending).rejects.toThrow('closed');
		expect(execute.mock.calls[0]![1].aborted).toBe(true);
	});

	it('rejects malformed, unsafe and conflicting local refs', () => {
		const snapshot = 'a'.repeat(32);
		for (const request of [
			{ref: `@s${snapshot}:e0`},
			{ref: `@s${snapshot}:e9007199254740992`},
			{ref: '@sbad:e1'},
			{ref: `@s${snapshot}:e1`, snapshot: 'b'.repeat(32)},
			{ref: `@s${snapshot}:e1`, element_id: 2},
		]) {
			expect(() => {
				validateWindowsRequest({action: 'invoke', ...request});
			}).toThrow('ref');
		}
	});

	it('normalizes batch refs and carries cancellation/pause options to actions', async () => {
		const {bridge, execute} = fixture();
		const result = await bridge.request(inspect);
		const controller = new AbortController();
		const request = vi.fn(async (args: WindowsRequest, config?: RequestOptions) => bridge.request(args, config));
		const runtime = {
			windows: {request}, companion: {state: {paused: false}},
			computerBatch: async (run: (perform: (action: string, work: () => Promise<unknown>) => Promise<unknown>) => Promise<unknown>) => run(async (_action, work) => work()),
		} as unknown as PokemonRuntime;
		const batch = await runWindowsBatch(runtime, windowsStepSchema.array().parse([{action: 'invoke', ref: `@s${String(result.snapshot)}:e1`}]), 2000, controller.signal);
		expect(batch.isError).not.toBe(true);
		expect(request.mock.calls[0]![0]).toMatchObject(target(result));
		expect(request.mock.calls[0]![1]).toMatchObject({signal: controller.signal, timeoutMs: 20_000});
		expect(execute.mock.calls[1]![0][1]).toBe(nativeRef);
		await runWindowsRequest(runtime, {action: 'get_windows'}, controller.signal);
		expect(request.mock.calls[1]![1]?.signal).toBe(controller.signal);
	});
});
