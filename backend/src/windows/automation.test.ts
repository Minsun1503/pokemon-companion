import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {
	describe, expect, it, vi,
} from 'vitest';
import {WindowsAutomation} from './automation.js';

vi.mock('node:child_process', () => ({spawn: vi.fn()}));

async function readUI(result: Record<string, unknown>) {
	const worker = Object.assign(new EventEmitter(), {
		stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
	});
	vi.mocked(spawn).mockReturnValue(worker as unknown as ChildProcessWithoutNullStreams);
	const automation = new WindowsAutomation();
	try {
		const pending = automation.request({action: 'get_ui', window_id: '123', max_chars: 1000});
		worker.stdout.write(`${JSON.stringify({id: 1, result})}\n`);
		return await pending;
	} finally {
		automation.close();
	}
}

const captions = ['Minimize', 'Maximize', 'Close'].map((name) => ({role: 'Button', name}));

describe.runIf(process.platform === 'win32')('Windows UI inspection', () => {
	it.each([{error: ''}, {}, {result: null}, {result: []}])('rejects an empty error or missing object result without replay: %j', async (response) => {
		const worker = Object.assign(new EventEmitter(), {
			stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
		});
		vi.mocked(spawn).mockReturnValue(worker as unknown as ChildProcessWithoutNullStreams);
		const automation = new WindowsAutomation();
		try {
			const pending = automation.request({action: 'get_ui', window_id: '123'});
			const rejected = expect(pending).rejects.toThrow('error' in response ? 'failed without an error message' : 'invalid response');
			worker.stdout.write(`${JSON.stringify({id: 1, ...response})}\n`);
			await rejected;
			expect(worker.stdin.read().toString().trim().split('\n')).toHaveLength(1);
			const fresh = automation.request({action: 'get_ui', window_id: '123'});
			worker.stdout.write(`${JSON.stringify({id: 2, result: {nodes: []}})}\n`);
			expect(await fresh).toEqual({nodes: []});
		} finally {
			automation.close();
		}
	});

	it('warms one persistent worker and reuses it for subsequent requests', async () => {
		const worker = Object.assign(new EventEmitter(), {
			stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
		});
		vi.mocked(spawn).mockClear().mockReturnValue(worker as unknown as ChildProcessWithoutNullStreams);
		const automation = new WindowsAutomation();
		try {
			automation.warm();
			automation.warm();
			for (const id of [1, 2]) {
				const pending = automation.request({action: 'get_windows'});
				worker.stdout.write(`${JSON.stringify({id, result: {windows: []}})}\n`);
				// eslint-disable-next-line no-await-in-loop
				expect(await pending).toEqual({windows: []});
			}

			expect(spawn).toHaveBeenCalledTimes(1);
		} finally {
			automation.close();
		}

		expect(worker.kill).toHaveBeenCalledOnce();
	});

	it.each(['cancel', 'pause', 'timeout'])('interrupts a blocked native poll on %s and releases the worker', async (reason) => {
		vi.useFakeTimers();
		const worker = Object.assign(new EventEmitter(), {
			stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
		});
		vi.mocked(spawn).mockReturnValue(worker as unknown as ChildProcessWithoutNullStreams);
		const automation = new WindowsAutomation();
		const controller = new AbortController();
		try {
			const pending = automation.request({action: 'get_ui', window_id: '123'}, {
				signal: controller.signal, timeoutMs: 250, paused: () => reason === 'pause', timeoutError: 'wait_for timed out. After an interrupted wait, call get_ui again for fresh snapshots.',
			});
			const checked = expect(pending).rejects.toThrow(reason === 'cancel' ? 'Computer action cancelled.' : reason === 'pause' ? 'paused by the user' : 'wait_for timed out');
			const fresh = expect(pending).rejects.toThrow('call get_ui again for fresh snapshots');
			if (reason === 'cancel') {
				controller.abort();
			}

			await vi.advanceTimersByTimeAsync(300);
			await checked;
			await fresh;
			expect(worker.kill).toHaveBeenCalledOnce();
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			automation.close();
			vi.useRealTimers();
		}
	});

	it.each([{nodes: captions}, {nodes: [{role: 'TitleBar', name: 'Test'}, ...captions]}])('hints when only caption controls are exposed: %j', async ({nodes}) => {
		const result = await readUI({nodes, matched: nodes.length, truncated: false});
		expect(result.hint).toBe('Only title-bar controls found. Call activate on this window and read again.');
		expect(result.nodes).toEqual(nodes);
	});

	it.each([
		{nodes: [], truncated: false},
		{nodes: [...captions, {role: 'Edit', name: 'Note'}], truncated: false},
		{nodes: [{role: 'Button', name: 'Verify input'}], truncated: false},
		{nodes: captions, truncated: true},
	])('does not mistake empty, mixed or incomplete results for a caption-only view: %j', async (input) => {
		expect(await readUI(input)).not.toHaveProperty('hint');
	});

	it('keeps hinted responses within max_chars', async () => {
		const result = await readUI({nodes: captions, truncated: false, window: {title: 'x'.repeat(800)}});
		expect(result.hint).toBeDefined();
		expect(JSON.stringify(result).length).toBeLessThanOrEqual(1000);
		expect(result.truncated).toBe(true);
	});

	it('bounds a large tree while preserving its node prefix', async () => {
		const nodes = Array.from({length: 250}, (_, index) => ({
			id: index + 1, role: 'Edit', name: 'Test', value: 'x'.repeat(160),
		}));
		const result = await readUI({nodes: [...nodes], matched: nodes.length, truncated: false});
		expect(JSON.stringify(result).length).toBeLessThanOrEqual(1000);
		expect(result.truncated).toBe(true);
		expect(result.nodes).toEqual(nodes.slice(0, (result.nodes as unknown[]).length));
	});
});
