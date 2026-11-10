import {
	afterEach, describe, expect, it, vi,
} from 'vitest';
import {PokemonRuntime} from '../pokemon/runtime.js';
import {desktopStatus} from './desktop.js';

afterEach(() => vi.useRealTimers());

describe.runIf(process.platform === 'win32')('desktop readiness', () => {
	it('checks the production protocol while paused without starting the pet or sending input', async () => {
		const runtime = new PokemonRuntime();
		runtime.companion.state.paused = true;
		const start = vi.spyOn(runtime.companion, 'start');
		const request = vi.spyOn(runtime.windows, 'request').mockResolvedValue({protocol_version: 1, worker: 'ready'});
		expect(await desktopStatus(runtime)).toMatchObject({paused: true, permissions: 'not_checked_per_target', native: {ready: true}});
		expect(request).toHaveBeenCalledTimes(1);
		expect(request.mock.calls[0]![0]).toEqual({action: 'status'});
		expect(start).not.toHaveBeenCalled();
	});

	it('bounds queue wait and never dispatches an expired readiness probe', async () => {
		vi.useFakeTimers();
		const runtime = new PokemonRuntime();
		let finish!: () => void;
		const blocked = runtime.exclusive(async () => new Promise<void>((resolve) => {
			finish = resolve;
		}));
		await Promise.resolve();
		const request = vi.spyOn(runtime.windows, 'request');
		const status = desktopStatus(runtime);
		await vi.advanceTimersByTimeAsync(5001);
		expect(await status).toMatchObject({native: {ready: false, error_details: {code: 'TIMEOUT', disposition: {delivery: 'not_delivered'}}}});
		finish();
		await blocked;
		await runtime.exclusive(async () => undefined);
		expect(request).not.toHaveBeenCalled();
	});

	it('redacts raw startup diagnostics that may contain local data', async () => {
		const runtime = new PokemonRuntime();
		vi.spyOn(runtime.windows, 'request').mockRejectedValue(new Error('secret from startup'));
		const status = await desktopStatus(runtime);
		expect(status.native.ready).toBe(false);
		expect(JSON.stringify(status)).not.toContain('secret from startup');
	});
});
