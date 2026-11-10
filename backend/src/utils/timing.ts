import {AsyncLocalStorage} from 'node:async_hooks';
import {performance} from 'node:perf_hooks';

type Timing = {tool: string; action: string; started: number; breakdown_ms: Record<string, number>};
const calls = new AsyncLocalStorage<Timing>();

export function recordTiming(name: string, elapsed: number): void {
	const call = calls.getStore();
	if (call) {
		call.breakdown_ms[name] = (call.breakdown_ms[name] ?? 0) + elapsed;
	}
}

export async function timedCall<T>(tool: string, action: string, run: () => Promise<T>): Promise<T> {
	if (process.env.POKEMON_TIMING !== '1') {
		return run();
	}

	const call: Timing = {
		tool, action, started: performance.now(),
		breakdown_ms: {
			queue_wait: 0, companion_before: 0, action: 0, companion_after: 0, serialization: 0,
		},
	};
	return calls.run(call, async () => {
		try {
			return await run();
		} finally {
			try {
				process.stderr.write(`[pokemon-timing] ${JSON.stringify({
					tool, action, total_ms: performance.now() - call.started, breakdown_ms: call.breakdown_ms,
				})}\n`);
			} catch {/* Optional diagnostics must not alter delivery or mask the original error. */}
		}
	});
}

export async function measure<T>(name: string, run: () => Promise<T>): Promise<T> {
	if (!calls.getStore()) {
		return run();
	}

	const started = performance.now();
	try {
		return await run();
	} finally {
		recordTiming(name, performance.now() - started);
	}
}

export function measureSync<T>(name: string, run: () => T): T {
	if (!calls.getStore()) {
		return run();
	}

	const started = performance.now();
	try {
		return run();
	} finally {
		recordTiming(name, performance.now() - started);
	}
}

export function serialize(value: unknown, space?: number): string {
	return measureSync('serialization', () => JSON.stringify(value, null, space));
}
