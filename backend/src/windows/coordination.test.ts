import {
	afterEach, describe, expect, it, vi,
} from 'vitest';
import {WindowsAutomation} from './automation.js';
import {PokemonRuntime} from '../pokemon/runtime.js';

afterEach(() => vi.useRealTimers());

describe.runIf(process.platform === 'win32')('desktop control lease', () => {
	it('holds one lease across every step of a runtime batch', async () => {
		const runtime = new PokemonRuntime();
		const lease = vi.spyOn(runtime.windows, 'withControlLease').mockImplementation(async (run) => run());
		vi.spyOn(runtime.companion, 'start').mockResolvedValue(undefined);
		vi.spyOn(runtime.companion, 'update').mockResolvedValue(undefined);
		await runtime.computerBatch(async (perform) => {
			await perform('get_ui', async () => ({content: []}));
			return perform('set_value', async () => ({content: []}));
		});
		expect(lease).toHaveBeenCalledOnce();
	});

	it('releases control after an operation throws without retrying the operation', async () => {
		const automation = new WindowsAutomation();
		const request = vi.spyOn(automation, 'request').mockResolvedValueOnce({acquired: true}).mockResolvedValueOnce({released: true});
		const run = vi.fn(async () => {
			throw new Error('operation failed');
		});
		await expect(automation.withControlLease(run)).rejects.toThrow('operation failed');
		expect(request.mock.calls.map(([args]) => args.action)).toEqual(['acquire_control', 'release_control']);
		expect(run).toHaveBeenCalledOnce();
	});

	it('expires a contender without running the action', async () => {
		const automation = new WindowsAutomation();
		vi.spyOn(automation, 'request').mockResolvedValue({acquired: false});
		const run = vi.fn();
		const pending = automation.withControlLease(run, undefined, undefined, 25);
		const rejected = expect(pending).rejects.toMatchObject({details: {code: 'CONTROL_BUSY', disposition: {delivery: 'not_delivered'}}});
		await rejected;
		expect(run).not.toHaveBeenCalled();
	});
});
