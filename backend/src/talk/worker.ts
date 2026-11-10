import {z} from 'zod';
import {appendFileSync} from 'node:fs';
import {PokemonRuntime} from '../pokemon/runtime.js';
import {pokemonIds, type Companion, type PokemonState} from '../pokemon/companion.js';
import {TalkTools} from './tools.js';

const state: PokemonState = {
	pet: 'pikachu', activity: 'idle', message: '', task: '', visible: true, paused: true, completedActions: 0,
};
const companion: Companion = {
	state,
	async start() {/* The parent owns the visible pet. */},
	async update(patch) {
		Object.assign(state, patch);
		process.send?.({event: 'state', patch});
	},
	async capture() {
		throw new Error('This Talk model uses text and native app controls. Screenshots require a vision model.');
	},
	async close() {/* No pet window is owned by this worker. */},
};
const runtime = new PokemonRuntime(companion);
const tools = new TalkTools(runtime);
let queue = Promise.resolve();

function audit(name: string, args: unknown, result: unknown): void {
	if (!process.env.POKEMON_AGENT_AUDIT) {
		return;
	}

	const input = args as Record<string, unknown>;
	const output = result as Record<string, unknown>;
	const fields = ['action', 'window_id', 'ref', 'element_id'];
	const outcome = ['verified', 'handoff', 'paused', 'error'];
	appendFileSync(process.env.POKEMON_AGENT_AUDIT, `${JSON.stringify({
		time: new Date().toISOString(), name,
		args: Object.fromEntries(fields.filter((key) => input?.[key] !== undefined).map((key) => [key, input[key]])),
		result: Object.fromEntries(outcome.filter((key) => output?.[key] !== undefined).map((key) => [key, output[key]])),
	})}\n`);
}

process.on('message', (message: {id: number; method: string; paused: boolean; name?: string; args?: unknown; pet?: string}) => {
	state.paused = Boolean(message.paused);
	if (message.method === 'pause') {
		return;
	}

	queue = queue.then(async () => {
		try {
			const pet = message.pet || 'pikachu';
			if (pokemonIds.includes(pet as PokemonState['pet'])) {
				state.pet = pet as PokemonState['pet'];
			}

			let result: unknown;
			if (message.method === 'authorize') {
				const {text} = z.object({text: z.string()}).parse(message.args);
				tools.begin(pet, text);
				result = {ready: true};
			} else {
				result = message.method === 'list' ? tools.list(pet) : await tools.call(message.name || '', message.args, pet);
			}

			process.send?.({id: message.id, result});
			if (message.method === 'call') {
				audit(message.name || '', message.args, result);
			}
		} catch (error) {
			const failure = error instanceof Error ? error.message : String(error);
			if (message.method === 'call') {
				audit(message.name || '', message.args, {error: failure});
			}

			process.send?.({id: message.id, error: failure});
		}
	});
});
process.on('disconnect', () => {
	void runtime.close().finally(() => process.exit(0));
});
