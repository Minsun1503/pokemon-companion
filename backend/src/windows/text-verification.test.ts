import {
	describe, expect, it, vi,
} from 'vitest';
import {PokemonRuntime} from '../pokemon/runtime.js';
import {rejectedAction} from '../utils/errors.js';
import {
	runWindowsBatch, runWindowsRequest, validateWindowsRequest, windowsStepSchema,
} from './batch.js';

const snapshot = 'a'.repeat(32);
const target = {action: 'read_text', snapshot, element_id: 1};
const longText = 'Full description\n'.repeat(100);

describe('live full text verification', () => {
	it('waits through an asynchronous update on the same proof without replaying the input', async () => {
		const runtime = new PokemonRuntime();
		vi.spyOn(runtime.windows, 'withControlLease').mockImplementation(async (run) => run());
		const request = vi.spyOn(runtime.windows, 'request')
			.mockResolvedValueOnce({ok: true})
			.mockResolvedValueOnce({text: ''})
			.mockResolvedValueOnce({text: longText});
		const result = await runWindowsBatch(runtime, windowsStepSchema.array().parse([
			{
				action: 'set_value', snapshot, element_id: 1, text: longText,
			},
			{...target, expect_text: longText, timeout_ms: 1000},
		]), 16000);
		expect(result.isError).not.toBe(true);
		expect(JSON.parse(result.content.find((item) => item.type === 'text')!.text)).toMatchObject({
			completed: 2, result: {text: longText, verified: true, attempts: 2},
		});
		expect(request.mock.calls.map(([args]) => args.action)).toEqual(['set_value', 'read_text', 'read_text']);
		expect(request.mock.calls.slice(1).every(([args]) => args.snapshot === snapshot && args.element_id === 1)).toBe(true);
		expect(request.mock.calls[1]![0]).not.toHaveProperty('expect_text');
	});

	it('accepts an empty exact expected value', async () => {
		const runtime = new PokemonRuntime();
		vi.spyOn(runtime.windows, 'request').mockResolvedValue({text: ''});
		expect(await runWindowsRequest(runtime, {...target, expect_text: ''})).toMatchObject({verified: true, attempts: 1});
	});

	it('rejects a matching clipped prefix instead of treating it as full text', async () => {
		const runtime = new PokemonRuntime();
		const request = vi.spyOn(runtime.windows, 'request').mockResolvedValue({text: longText, truncated: true});
		await expect(runWindowsRequest(runtime, {...target, expect_text: longText})).rejects.toMatchObject({details: {code: 'INCOMPLETE_SNAPSHOT'}});
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('bounds readback timeout and stops later input with stopped-step retry evidence', async () => {
		const runtime = new PokemonRuntime();
		vi.spyOn(runtime.windows, 'withControlLease').mockImplementation(async (run) => run());
		const request = vi.spyOn(runtime.windows, 'request').mockResolvedValue({text: 'wrong'});
		const result = await runWindowsBatch(runtime, windowsStepSchema.array().parse([
			{...target, expect_text: longText, timeout_ms: 25},
			{
				action: 'set_value', snapshot, element_id: 1, text: longText,
			},
		]), 16000);
		expect(result.isError).toBe(true);
		expect(JSON.parse(result.content.find((item) => item.type === 'text')!.text)).toMatchObject({
			completed: 0, stopped_step: 0, retry_scope: 'stopped_step', error_details: {code: 'TIMEOUT', disposition: {retry: 'safe'}},
		});
		expect(request.mock.calls.every(([args]) => args.action === 'read_text')).toBe(true);
		expect(request.mock.calls[0]![1]?.timeoutMs).toBeLessThanOrEqual(25);
	});

	it.each(['pause', 'cancel'])('honors %s after a read even when the value matches', async (reason) => {
		const runtime = new PokemonRuntime();
		const controller = new AbortController();
		vi.spyOn(runtime.windows, 'request').mockImplementation(async () => {
			if (reason === 'pause') {
				runtime.companion.state.paused = true;
			} else {
				controller.abort();
			}

			return {text: longText};
		});
		await expect(runWindowsRequest(runtime, {...target, expect_text: longText}, controller.signal)).rejects.toMatchObject({
			details: {code: reason === 'pause' ? 'PAUSED' : 'CANCELLED', disposition: {retry: 'unsafe'}},
		});
	});

	it('propagates identity failure without rediscovering or retrying', async () => {
		const runtime = new PokemonRuntime();
		const request = vi.spyOn(runtime.windows, 'request').mockRejectedValue(rejectedAction('STALE_REF', 'Expired proof'));
		await expect(runWindowsRequest(runtime, {...target, expect_text: longText})).rejects.toMatchObject({details: {code: 'STALE_REF'}});
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('prevalidates unsupported actions and platforms before any input', () => {
		expect(() => {
			validateWindowsRequest({
				action: 'set_value', snapshot, element_id: 1, text: longText, expect_text: longText,
			}, 'win32');
		}).toThrow('only by read_text');
		expect(() => {
			validateWindowsRequest({...target, expect_text: longText}, 'linux');
		}).toThrow('requires Windows');
		expect(windowsStepSchema.safeParse({...target, expect_text: 'x'.repeat(8001)}).success).toBe(false);
	});
});
