import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	afterEach, expect, it, vi,
} from 'vitest';
import {type PokemonRuntime} from '../pokemon/runtime.js';
import {RecordingService} from './service.js';
import {DesktopRecorder} from './desktop.js';
const cleanups: (() => Promise<void>)[] = [];
vi.setConfig({testTimeout: 30000, hookTimeout: 30000});
afterEach(async () => {
	vi.restoreAllMocks();
	for (const close of cleanups.splice(0).reverse()) {
		// eslint-disable-next-line no-await-in-loop -- Close each recorder before removing its exact fixture store.
		await close();
	}
});
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), 'pokemon-recording-test-'));
	const identity = {
		process_id: 100, process_started: 'birth', image_path: 'fixture.exe', process_family: [100, 101],
	};
	const runtime = {
		companion: {state: {paused: false}},
		browser: {allPages: () => [{page_id: 'page', url: 'https://fixture.test/?token=HIDDEN'}], launch: vi.fn()},
		api: {
			watchStart: vi.fn(), watchStop: vi.fn(), watchRead: vi.fn(async () => ({
				watching: true, truncated: false, operations: [{
					last_seen: Date.now(), method: 'GET', endpoint: 'https://fixture.test/api/list', status: 200, operation_id: 'operation', revision: 1,
				}],
			})), inspect: vi.fn(),
		},
		windows: {
			request: vi.fn(async (input: {
				action: string;
			}) => input.action === 'app_identity'
				? identity
				: {
					windows: [{
						id: 'window', window_ref: 'proof', title: 'Fixture', process: 'fixture', process_id: 100,
					}],
				}),
		},
		authorize: vi.fn(async () => undefined),
	};
	const recorder = new RecordingService(runtime as unknown as PokemonRuntime, directory);
	cleanups.push(async () => rm(directory, {recursive: true, force: true}), async () => recorder.close());
	return {
		recorder, runtime, identity, directory,
	};
}

it('rejects unknown commands and unobserved targets before recording', async () => {
	const {recorder, runtime} = await fixture();
	await expect(recorder.request({action: 'start', mode: 'desktop', target: 'unseen'})).rejects.toThrow('observed');
	await expect(recorder.request({action: 'status', cookie: 'secret'})).rejects.toThrow();
	expect(runtime.authorize).not.toHaveBeenCalled();
});
it('stops without replaying and keeps a readable, encrypted browser trace after restart', async () => {
	const {recorder, runtime, directory} = await fixture();
	const targets = await recorder.request({action: 'targets'});
	expect(JSON.stringify(targets)).not.toContain('HIDDEN');
	await recorder.request({
		action: 'start', mode: 'browser', target: 'page', label: 'Open inbox',
	});
	await recorder.request({action: 'stop'});
	expect(runtime.api.watchStop).toHaveBeenCalledWith('page');
	const exported = await recorder.request({action: 'export'}) as {
		text: string;
	};
	expect(JSON.parse(exported.text).recording.entries).toHaveLength(1);
	expect(await readFile(join(directory, 'trace', 'events.enc'), 'utf8')).not.toContain('Open inbox');
	await recorder.close();
	const reopened = new RecordingService(runtime as unknown as PokemonRuntime, directory);
	cleanups.push(async () => reopened.close());
	expect((await reopened.request({action: 'status'}) as {
		active: boolean;
	}).active).toBe(false);
}, 20000);
it('denied desktop approval never launches a proxy', async () => {
	const {recorder, runtime} = await fixture();
	const start = vi.spyOn(DesktopRecorder.prototype, 'start').mockResolvedValue();
	runtime.authorize.mockRejectedValue(new Error('Approval required'));
	await recorder.request({action: 'targets'});
	await expect(recorder.request({action: 'start', mode: 'desktop', target: 'window'})).rejects.toThrow('Approval required');
	expect(start).not.toHaveBeenCalled();
});
it('binds capture to verified PIDs and stops when paused', async () => {
	const {recorder, runtime} = await fixture();
	const start = vi.spyOn(DesktopRecorder.prototype, 'start').mockResolvedValue();
	const stop = vi.spyOn(DesktopRecorder.prototype, 'stop').mockResolvedValue();
	await recorder.request({action: 'targets'});
	await recorder.request({
		action: 'start', mode: 'desktop', target: 'window', label: 'Read data',
	});
	expect(start).toHaveBeenCalledWith([100, 101]);
	await expect(recorder.request({action: 'start', mode: 'browser', target: 'page'})).rejects.toThrow('Stop');
	runtime.companion.state.paused = true;
	recorder.pause(true);
	expect((await recorder.request({action: 'status'}) as {
		active: boolean;
	}).active).toBe(false);
	expect(stop).toHaveBeenCalled();
});
it('fails closed if a selected process identity changes during consent', async () => {
	const {recorder, runtime, identity} = await fixture();
	const start = vi.spyOn(DesktopRecorder.prototype, 'start').mockResolvedValue();
	runtime.authorize.mockImplementation(async () => {
		identity.process_started = 'new process';
	});
	await recorder.request({action: 'targets'});
	await expect(recorder.request({action: 'start', mode: 'desktop', target: 'window'})).rejects.toThrow('changed');
	expect(start).not.toHaveBeenCalled();
});
