import {AsyncLocalStorage} from 'node:async_hooks';
import {performance} from 'node:perf_hooks';

type Timing = {tool: string; action: string; started: number; breakdown_ms: Record<string, number>; counts: Record<string, number>};
const calls = new AsyncLocalStorage<Timing>();

export function recordTiming(name: string, elapsed: number): void {
	const call = calls.getStore();
	if (call) {
		call.breakdown_ms[name] = (call.breakdown_ms[name] ?? 0) + elapsed;
	}
}

const nativePhases = new Set([
	'window_metadata_inclusive',
	'window_enumeration_inclusive',
	'discovery_inclusive',
	'act_inclusive',
	'window_capture_inclusive',
	'window_verify',
	'element_verify_inclusive',
	'identity_resolve_inclusive',
	'identity_projection',
	'identity_cache_fetch',
	'ancestor_navigation',
	'tree_walk_inclusive',
	'navigation_cache_fetch',
	'visit_projection_inclusive',
	'discovery_value_read',
	'pattern_dispatch_inclusive',
	'pattern_action',
	'post_action_value_read',
	'text_range_find',
	'text_range_extract',
]);

/** Consume internal diagnostics in the requesting async context, never in the shared stdout callback. */
export function recordNativeProfile(profile: unknown): void {
	const call = calls.getStore();
	if (!call || !profile || typeof profile !== 'object') {
		return;
	}

	const {phase_ms: phases, counts} = profile as {phase_ms?: unknown; counts?: unknown};
	for (const [source, destination, prefix] of [[phases, call.breakdown_ms, 'native_'], [counts, call.counts, 'native_']] as const) {
		if (!source || typeof source !== 'object' || Array.isArray(source)) {
			continue;
		}

		for (const [name, value] of Object.entries(source)) {
			if (nativePhases.has(name) && typeof value === 'number' && Number.isFinite(value) && value >= 0) {
				destination[prefix + name] = (destination[prefix + name] ?? 0) + value;
			}
		}
	}
}

export async function timedCall<T>(tool: string, action: string, run: () => Promise<T>): Promise<T> {
	if (process.env.POKEMON_TIMING !== '1') {
		return run();
	}

	const call: Timing = {
		tool, action, started: performance.now(), counts: {},
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
					tool, action, total_ms: performance.now() - call.started, breakdown_ms: call.breakdown_ms, counts: call.counts,
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
