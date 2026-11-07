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
});
