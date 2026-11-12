import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {
	afterEach, expect, it, vi,
} from 'vitest';
import {traceClientCall} from './client-timing.js';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

const decode = (line: unknown) => JSON.parse(String(line).slice('[pokemon-client-timing] '.length));

it('separates serial client gaps from handler time without logging content', async () => {
	vi.stubEnv('POKEMON_TIMING', '1');
	const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	let now = 10;
	vi.spyOn(performance, 'now').mockImplementation(() => now);
	const id = randomUUID();
	expect(await traceClientCall(id, 'windows', 'get_ui', async () => {
		now = 30;
		return {private: 'content'};
	})).toEqual({private: 'content'});
	now = 70;
	await traceClientCall(id, 'windows', 'invoke', async () => {
		now = 80;
	});
	const logs = write.mock.calls.map(([line]) => decode(line));
	expect(logs[0]).toMatchObject({server_ms: 20, client_gap_ms: null});
	expect(logs[1]).toMatchObject({
		server_ms: 10, client_gap_ms: 40, previous_action: 'get_ui', overlapping_calls: false,
	});
	expect(JSON.stringify(logs)).not.toContain('content');
	await traceClientCall(randomUUID(), 'windows', 'get_ui', async () => undefined);
	expect(decode(write.mock.calls[2]![0]).client_gap_ms).toBeNull();
});

it('does not attribute overlapping calls or their next call to a serial decision', async () => {
	vi.stubEnv('POKEMON_TIMING', '1');
	const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	const id = randomUUID();
	await traceClientCall(id, 'windows', 'get_ui', async () => undefined);
	write.mockClear();
	let release!: () => void;
	const first = traceClientCall(id, 'windows', 'get_ui', async () => new Promise<void>((resolve) => {
		release = resolve;
	}));
	await traceClientCall(id, 'desktop', 'status', async () => undefined);
	release();
	await first;
	await traceClientCall(id, 'windows', 'get_ui', async () => undefined);
	const logs = write.mock.calls.map(([line]) => decode(line));
	expect(logs.slice(0, 2).every((log) => log.overlapping_calls && log.client_gap_ms === null)).toBe(true);
	expect(logs[2].client_gap_ms).toBeNull();
});

it('bounds chains without evicting active calls and forgets an evicted task gap', async () => {
	vi.stubEnv('POKEMON_TIMING', '1');
	const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	vi.resetModules();
	const {traceClientCall: trace} = await import('./client-timing.js');
	const ids = Array.from({length: 32}, () => randomUUID());
	const releases: (() => void)[] = [];
	const active = ids.map(async (id) => trace(id, 'windows', 'get_ui', async () => new Promise<void>((resolve) => {
		releases.push(resolve);
	})));
	expect(await trace(randomUUID(), 'windows', 'get_ui', async () => 'untracked')).toBe('untracked');
	expect(write).not.toHaveBeenCalled();
	releases[0]!();
	await active[0];
	await trace(randomUUID(), 'windows', 'get_ui', async () => undefined);
	await trace(ids[0], 'windows', 'get_ui', async () => undefined);
	expect(write.mock.calls.map(([line]) => decode(line).client_gap_ms)).toEqual([null, null, null]);
	releases.slice(1).forEach((release) => {
		release();
	});
	await Promise.all(active);
	expect(write).toHaveBeenCalledTimes(34);
});

it('preserves original failures when diagnostics fail and keeps disabled calls untraced', async () => {
	vi.stubEnv('POKEMON_TIMING', '1');
	const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => {
		throw new Error('sink failure');
	});
	await expect(traceClientCall(randomUUID(), 'windows', 'invoke', async () => {
		throw new Error('original failure');
	})).rejects.toThrow('original failure');
	write.mockClear();
	expect(await traceClientCall(undefined, 'windows', 'invoke', async () => 'unattributed')).toBe('unattributed');
	expect(write).not.toHaveBeenCalled();
	vi.stubEnv('POKEMON_TIMING', '0');
	expect(await traceClientCall(randomUUID(), 'windows', 'invoke', async () => 'ok')).toBe('ok');
	expect(write).not.toHaveBeenCalled();
});
