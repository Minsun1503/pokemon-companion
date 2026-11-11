import {
	afterEach, describe, expect, it, vi,
} from 'vitest';
import {
	measure, recordNativeProfile, serialize, timedCall,
} from './timing.js';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe('optional tool timing', () => {
	it('accepts only known numeric native phases and counters', async () => {
		vi.stubEnv('POKEMON_TIMING', '1');
		const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		await timedCall('windows', 'get_ui', async () => {
			recordNativeProfile({phase_ms: {navigation_cache_fetch: 12, private: 100, window_verify: NaN}, counts: {navigation_cache_fetch: 4, private: 1}});
			recordNativeProfile({phase_ms: {navigation_cache_fetch: 3}, counts: {navigation_cache_fetch: 2}});
		});
		const log = JSON.parse(String(write.mock.calls[0][0]).slice('[pokemon-timing] '.length));
		expect(log.breakdown_ms.native_navigation_cache_fetch).toBe(15);
		expect(log.counts).toEqual({native_navigation_cache_fetch: 6});
		expect(JSON.stringify(log)).not.toContain('private');
		expect(log.breakdown_ms).not.toHaveProperty('native_window_verify');
	});
	it('preserves results and original failures if the diagnostic sink throws', async () => {
		vi.stubEnv('POKEMON_TIMING', '1');
		vi.spyOn(process.stderr, 'write').mockImplementation(() => {
			throw new Error('diagnostic sink unavailable');
		});
		expect(await timedCall('windows', 'invoke', async () => 'acknowledged')).toBe('acknowledged');
		await expect(timedCall('windows', 'invoke', async () => {
			throw new Error('original action failure');
		})).rejects.toThrow('original action failure');
	});
	it('does not log or change results when disabled', async () => {
		vi.stubEnv('POKEMON_TIMING', '0');
		const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		expect(await timedCall('windows', 'get_ui', async () => serialize({value: 'private'}))).toBe('{"value":"private"}');
		expect(write).not.toHaveBeenCalled();
	});

	it('logs separate calls and nested spans without exposing field contents', async () => {
		vi.stubEnv('POKEMON_TIMING', '1');
		const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		const run = async () => measure('action', async () => serialize({value: 'private'}));
		await Promise.all(['get_ui', 'set_value'].map(async (action) => timedCall('windows', action, run)));
		const logs = write.mock.calls.map(([line]) => JSON.parse(String(line).slice('[pokemon-timing] '.length)));
		expect(logs.map((log) => log.action).sort((a, b) => a.localeCompare(b))).toEqual(['get_ui', 'set_value']);
		for (const log of logs) {
			expect(log.total_ms).toBeGreaterThanOrEqual(0);
			expect(log.breakdown_ms.action).toBeGreaterThanOrEqual(log.breakdown_ms.serialization);
			expect(JSON.stringify(log)).not.toContain('private');
		}
	});

	it('preserves the original error and still records a failing call', async () => {
		vi.stubEnv('POKEMON_TIMING', '1');
		const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		await expect(timedCall('computer', 'key', async () => {
			throw new Error('Invalid key: example');
		})).rejects.toThrow('Invalid key: example');
		expect(write).toHaveBeenCalledOnce();
	});
});
