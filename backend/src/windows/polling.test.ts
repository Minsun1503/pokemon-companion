import {
	afterEach, describe, expect, it, vi,
} from 'vitest';
import {PokemonRuntime} from '../pokemon/runtime.js';
import {
	runWindowsBatch, runWindowsRequest, validateWindowsRequest as validateRequest, windowsStepSchema,
} from './batch.js';

// These cases exercise native Windows validation even when the test host is macOS/Linux.
const validateWindowsRequest = (args: Parameters<typeof validateRequest>[0]) => {
	validateRequest(args, 'win32');
};

afterEach(() => vi.useRealTimers());
const control = {
	window: {id: '123', window_ref: 'b'.repeat(32)}, snapshot: 'a'.repeat(32), truncated: false, matched: 1, nodes: [{id: 1, value: 'ready', actions: ['focus']}],
};

describe('Windows polling actions', () => {
	it('pins polling to the first observed window identity', async () => {
		const runtime = new PokemonRuntime();
		const request = vi.spyOn(runtime.windows, 'request')
			.mockResolvedValueOnce({...control, window: {id: '123', window_ref: 'b'.repeat(32)}, nodes: []})
			.mockRejectedValueOnce(new Error('window replaced'));
		await expect(runWindowsRequest(runtime, {action: 'wait_for', window_id: '123', query: 'Note'})).rejects.toThrow('window replaced');
		expect(request.mock.calls[1]![0].window_ref).toBe('b'.repeat(32));
	});

	it('requires complete zero-match coverage for absence after a verified baseline', async () => {
		const runtime = new PokemonRuntime();
		const request = vi.spyOn(runtime.windows, 'request')
			.mockResolvedValueOnce({window_ref: 'b'.repeat(32)})
			.mockResolvedValueOnce({
				...control, nodes: [], matched: 0, complete: false, truncated: true,
			})
			.mockResolvedValueOnce({
				...control, nodes: [], matched: 0, complete: true, truncated: false,
			});
		const result = await runWindowsRequest(runtime, {
			action: 'wait_for', window_id: '123', query: 'Note', wait_condition: 'absent', snapshot: control.snapshot, element_id: 1,
		});
		expect(result).toMatchObject({condition: 'absent', verified: true});
		expect(request.mock.calls.map(([args]) => args.action)).toEqual(['wait_baseline', 'get_ui', 'get_ui']);
		expect(request.mock.calls[1]![0].window_ref).toBe('b'.repeat(32));
	});

	it('propagates cancellation controls on ordinary native actions', async () => {
		const runtime = new PokemonRuntime();
		const controller = new AbortController();
		const request = vi.spyOn(runtime.windows, 'request').mockResolvedValue({ok: true});
		await runWindowsRequest(runtime, {action: 'invoke', snapshot: control.snapshot, element_id: 1}, controller.signal);
		expect(request.mock.calls[0]![1]?.signal).toBe(controller.signal);
		expect(request.mock.calls[0]![1]?.paused()).toBe(false);
		runtime.companion.state.paused = true;
		expect(request.mock.calls[0]![1]?.paused()).toBe(true);
	});

	it('rejects unsupported absence and partial subtree inputs before executing', () => {
		expect(() => {
			validateWindowsRequest({
				action: 'wait_for', window_id: '123', query: 'Note', wait_condition: 'absent',
			});
		}).toThrow('earlier unique observation');
		expect(() => {
			validateWindowsRequest({action: 'get_ui', window_id: '123', root_snapshot: control.snapshot});
		}).toThrow('together');
	});

	it('waits through absent and stale values, rejecting clipped previews', async () => {
		const runtime = new PokemonRuntime();
		const request = vi.spyOn(runtime.windows, 'request')
			.mockResolvedValueOnce({...control, nodes: []})
			.mockResolvedValueOnce({...control, nodes: [{...control.nodes[0], value: 'old'}]})
			.mockResolvedValueOnce({...control, nodes: [{...control.nodes[0], value_clipped: true}]})
			.mockResolvedValue(control);
		const result = await runWindowsRequest(runtime, {
			action: 'wait_for', window_id: '123', query: 'Note', expect_value: 'ready',
		});
		expect(result).toEqual(control);
		expect(request).toHaveBeenCalledTimes(4);
		expect(request.mock.calls.every(([args]) => args.action === 'get_ui')).toBe(true);
	});

	it('launches once, then polls and reports the executable', async () => {
		const runtime = new PokemonRuntime();
		const request = vi.spyOn(runtime.windows, 'request')
			.mockResolvedValueOnce({started: 'C:/Test.exe', query: 'Test'})
			.mockResolvedValueOnce({windows: []})
			.mockResolvedValueOnce({windows: [{id: '123'}]});
		expect(await runWindowsRequest(runtime, {action: 'launch', text: 'Test.exe'})).toMatchObject({started: 'C:/Test.exe', windows: [{id: '123'}]});
		expect(request.mock.calls.map(([args]) => args.action)).toEqual(['launch', 'get_windows', 'get_windows']);
		expect(request.mock.calls[1]![0].query).toBe('Test');
	});

	it('reports successful URL launch and at most five new/changed windows on timeout', async () => {
		vi.useFakeTimers();
		const runtime = new PokemonRuntime();
		const request = vi.spyOn(runtime.windows, 'request')
			.mockResolvedValueOnce({windows: [{id: '1', title: 'Old page', process: 'msedge'}]})
			.mockResolvedValueOnce({started: 'https://example.com'})
			.mockResolvedValue({windows: Array.from({length: 7}, (_, index) => ({id: String(index + 1), title: `New page ${index}`, process: 'msedge'}))});
		const pending = runWindowsRequest(runtime, {
			action: 'launch', text: 'https://example.com', query: 'Missing title', timeout_ms: 250,
		});
		const checked = expect(pending).rejects.toThrow('URL launch succeeded');
		const diagnostic = pending.catch((error: unknown) => error instanceof Error ? error.message : String(error));
		await vi.advanceTimersByTimeAsync(300);
		await checked;
		const message = await diagnostic;
		expect(message).toContain('browser process name');
		expect(message).toContain('New page 4');
		expect(message).not.toContain('New page 5');
		expect(request.mock.calls.filter(([args]) => args.action === 'launch')).toHaveLength(1);
	});

	it('uses the original filtered lookup when a URL diagnostic list is truncated', async () => {
		const runtime = new PokemonRuntime();
		vi.spyOn(runtime.windows, 'request')
			.mockResolvedValueOnce({windows: []})
			.mockResolvedValueOnce({started: 'https://example.com'})
			.mockResolvedValueOnce({windows: [{id: '1', title: 'Other', process: 'app'}], truncated: true})
			.mockResolvedValueOnce({windows: [{id: '2', title: 'Browser', process: 'msedge'}], truncated: false});
		const result = await runWindowsRequest(runtime, {action: 'launch', text: 'https://example.com', query: 'msedge'});
		expect(result).toMatchObject({windows: [{id: '2'}], truncated: false});
	});

	it.each(['pause', 'cancel', 'timeout'])('stops polling on %s', async (reason) => {
		vi.useFakeTimers();
		const runtime = new PokemonRuntime();
		const controller = new AbortController();
		vi.spyOn(runtime.windows, 'request').mockImplementation(async () => {
			if (reason === 'pause') {
				runtime.companion.state.paused = true;
			} else if (reason === 'cancel') {
				controller.abort();
			}

			return {nodes: []};
		});
		const pending = runWindowsRequest(runtime, {
			action: 'wait_for', window_id: '123', query: 'Note', timeout_ms: 250,
		}, controller.signal);
		const checked = expect(pending).rejects.toThrow(reason === 'pause' ? 'paused by the user' : reason === 'cancel' ? 'Computer action cancelled.' : 'wait_for timed out after 250 ms');
		const fresh = expect(pending).rejects.toThrow('call get_ui again for fresh snapshots');
		await vi.advanceTimersByTimeAsync(300);
		await checked;
		await fresh;
	});

	it('passes the remaining deadline to native reads', async () => {
		const runtime = new PokemonRuntime();
		const request = vi.spyOn(runtime.windows, 'request').mockResolvedValue(control);
		await runWindowsRequest(runtime, {
			action: 'wait_for', query: 'Note', window_id: '123', timeout_ms: 300,
		});
		expect(request.mock.calls[0]![1]?.timeoutMs).toBeLessThanOrEqual(300);
		expect(request.mock.calls[0]![1]?.timeoutError).toContain('300 ms');
	});

	it('supports launch and wait_for discovery references inside a batch', async () => {
		const runtime = new PokemonRuntime();
		vi.spyOn(runtime, 'computerBatch').mockImplementation(async (run) => run(async (_action, execute) => execute()));
		const request = vi.spyOn(runtime.windows, 'request')
			.mockResolvedValueOnce({started: 'C:/Test.exe', query: 'Test'})
			.mockResolvedValueOnce({windows: [{id: '123'}]})
			.mockResolvedValueOnce(control)
			.mockResolvedValueOnce({ok: true});
		const result = await runWindowsBatch(runtime, windowsStepSchema.array().parse([
			{action: 'launch', text: 'Test.exe'},
			{
				action: 'wait_for', window_step: 0, query: 'Note', expect_value: 'ready',
			},
			{action: 'focus', target_step: 1},
		]), 2000);
		expect(result.isError).not.toBe(true);
		expect(request.mock.calls[2]![0].window_id).toBe('123');
		expect(request.mock.calls[3]![0]).toMatchObject({action: 'focus', snapshot: control.snapshot, element_id: 1});
	});

	it.each(['test.cmd', 'cmd.exe /c echo hello', 'https://example.com\ncalc.exe', 'file:///C:/test.exe', 'test.exe | whoami'])('rejects a shell command or unsupported target: %s', (text) => {
		expect(() => {
			validateWindowsRequest({action: 'launch', text, query: 'Test'});
		}).toThrow();
	});

	it.each(['cmd', 'powershell', 'pwsh', 'wscript', 'cscript', 'mshta'].flatMap((name) => [name, `${name}.exe`, `C:\\Windows\\System32\\${name.toUpperCase()}.EXE`]))('rejects a shell or script host by name/path: %s', (text) => {
		expect(() => {
			validateWindowsRequest({action: 'launch', text});
		}).toThrow('command shells or script hosts');
	});

	it('requires a URL window query and bounds timeouts', () => {
		expect(() => {
			validateWindowsRequest({action: 'launch', text: 'https://example.com'});
		}).toThrow('requires query');
		expect(() => {
			validateWindowsRequest({action: 'wait_for', window_id: '123'});
		}).toThrow('requires query or control_type');
		expect(windowsStepSchema.safeParse({action: 'wait_for', timeout_ms: 15001}).success).toBe(false);
	});

	it('bounds the combined launch response honestly', async () => {
		const runtime = new PokemonRuntime();
		vi.spyOn(runtime.windows, 'request')
			.mockResolvedValueOnce({started: `C:/${'x'.repeat(2000)}.exe`, query: 'Test'})
			.mockResolvedValueOnce({windows: [{id: '123'}]});
		const result = await runWindowsRequest(runtime, {action: 'launch', text: 'Test.exe', max_chars: 1000});
		expect(JSON.stringify(result).length).toBeLessThanOrEqual(1000);
		expect(result.started_clipped).toBe(true);
		expect(result.truncated).toBe(true);
	});

	it('refuses to retry a launch after a successful dispatch and timed-out observation', async () => {
		vi.useFakeTimers();
		const runtime = new PokemonRuntime();
		const request = vi.spyOn(runtime.windows, 'request').mockResolvedValueOnce({started: 'C:/Test.exe', query: 'Test'}).mockResolvedValue({windows: []});
		const pending = runWindowsRequest(runtime, {action: 'launch', text: 'Test.exe', timeout_ms: 250});
		const rejection = expect(pending).rejects.toMatchObject({details: {code: 'TIMEOUT', disposition: {delivery: 'delivery_uncertain', retry: 'unsafe'}}});
		await vi.advanceTimersByTimeAsync(300);
		await rejection;
		expect(request.mock.calls.filter(([args]) => args.action === 'launch')).toHaveLength(1);
	});
});
