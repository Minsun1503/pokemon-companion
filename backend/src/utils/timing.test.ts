import {
	afterEach, describe, expect, it, vi,
} from 'vitest';
import {measure, serialize, timedCall} from './timing.js';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe('optional tool timing', () => {
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
