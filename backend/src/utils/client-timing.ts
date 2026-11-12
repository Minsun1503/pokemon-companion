import {performance} from 'node:perf_hooks';

type Completion = {at: number; tool: string; action: string};
type Chain = {active: number; overlap: boolean; previous?: Completion | undefined};
const chains = new Map<string, Chain>();

/** The response-to-next-request gap includes the client/model, transport and human waits. */
export async function traceClientCall<T>(taskId: string | undefined, tool: string, action: string, run: () => Promise<T>): Promise<T> {
	if (process.env.POKEMON_TIMING !== '1' || !taskId) {
		return run();
	}

	let chain = chains.get(taskId);
	if (!chain) {
		if (chains.size >= 32) {
			const oldest = [...chains].find(([, item]) => item.active === 0);
			if (!oldest) {
				return run();
			}

			chains.delete(oldest[0]);
		}

		chain = {active: 0, overlap: false};
	}

	chains.delete(taskId);
	chains.set(taskId, chain);
	const previous = chain.active === 0 ? chain.previous : undefined;
	const started = performance.now();
	const startedAt = new Date().toISOString();
	chain.overlap ||= chain.active > 0;
	chain.active += 1;
	try {
		return await run();
	} finally {
		const finished = performance.now();
		const {overlap} = chain;
		chain.active -= 1;
		if (chain.active === 0) {
			chain.previous = overlap ? undefined : {at: finished, tool, action};
			chain.overlap = false;
		}

		try {
			process.stderr.write(`[pokemon-client-timing] ${JSON.stringify({
				task_id: taskId, tool, action, started_at: startedAt, finished_at: new Date().toISOString(),
				server_ms: finished - started, client_gap_ms: !overlap && previous ? started - previous.at : null,
				previous_tool: overlap ? undefined : previous?.tool, previous_action: overlap ? undefined : previous?.action, overlapping_calls: overlap,
			})}\n`);
		} catch {/* Diagnostics must not change an action's delivery or original error. */}
	}
}
