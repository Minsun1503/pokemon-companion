import {
	describe, expect, it, vi,
} from 'vitest';
import type {Companion, PokemonState} from './companion.js';
import {PokemonRuntime} from './runtime.js';
import {jsonResult} from '../utils/response.js';

function fixture() {
	const events: string[] = [];
	const companion: Companion = {
		state: {
			pet: 'pikachu', activity: 'idle', message: '', task: '', visible: true, paused: false, completedActions: 0,
		},
		async start() {
			return undefined;
		},
		async close() {
			return undefined;
		},
		async update(patch: Partial<PokemonState>) {
			Object.assign(this.state, patch);
			events.push(`lock:${String(patch.interactionLocked)}`);
		},
		animate(patch: Partial<PokemonState>) {
			Object.assign(this.state, patch);
			events.push(`state:${this.state.activity}`);
		},
		async capture(hidden: boolean) {
			events.push(hidden ? 'hide' : 'restore');
		},
	};
	return {runtime: new PokemonRuntime(companion), companion, events};
}

describe('Pokémon desktop execution', () => {
	it('hides the companion only around capture and restores it after an error', async () => {
		const {runtime, companion, events} = fixture();
		await expect(runtime.computer('get_screenshot', undefined, async () => {
			events.push('capture');
			throw new Error('capture failed');
		})).rejects.toThrow('capture failed');
		expect(events).toEqual(['lock:true', 'state:thinking', 'hide', 'capture', 'state:error', 'lock:false', 'restore']);
		expect(companion.state.interactionLocked).toBe(false);
	});
	it('never executes input while the user has paused', async () => {
		const {runtime, companion, events} = fixture();
		companion.state.paused = true;
		await expect(runtime.computer('type', undefined, async () => {
			events.push('input');
			return jsonResult({ok: true});
		})).rejects.toThrow('paused');
		expect(events).toEqual([]);
	});
	it('serializes concurrent clients and retains task activity between actions', async () => {
		const {runtime, companion, events} = fixture();
		companion.state.task = 'Write a note';
		let finish: () => void = () => undefined;
		const waiting = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const first = runtime.computer('type', undefined, async () => {
			events.push('first');
			await waiting;
			return jsonResult({ok: true});
		});
		const second = runtime.computer('key', undefined, async () => {
			events.push('second');
			return jsonResult({ok: true});
		});
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
		expect(events).toEqual(['lock:true', 'state:working', 'first']);
		expect(companion.state.interactionLocked).toBe(true);
		finish();
		await Promise.all([first, second]);
		expect(events.indexOf('second')).toBeGreaterThan(events.indexOf('first'));
		expect(companion.state.activity).toBe('working');
		expect(companion.state.completedActions).toBe(2);
		expect(companion.state.interactionLocked).toBe(false);
	});
	it('honors cancellation while an action is queued', async () => {
		const {runtime, events} = fixture();
		const controller = new AbortController();
		controller.abort();
		await expect(runtime.computer('left_click', [10, 10], async () => {
			events.push('input');
			return jsonResult({ok: true});
		}, controller.signal)).rejects.toThrow('cancelled');
		expect(events).toEqual([]);
	});

	it.each(['reject', 'hang', 'throw'])('does not fail or wait for a cosmetic companion that can %s', async (failure) => {
		const {runtime, companion, events} = fixture();
		delete companion.animate;
		const update = companion.update.bind(companion);
		companion.update = vi.fn(async (patch) => {
			if ('interactionLocked' in patch) {
				return update(patch);
			}

			if (failure === 'throw') {
				throw new Error('Cosmetic failure');
			}

			return failure === 'hang' ? new Promise(() => {/* Deliberately stalled cosmetic bridge. */}) : Promise.reject(new Error('Cosmetic failure'));
		});
		if (failure === 'throw') {
			companion.animate = () => {
				throw new Error('Cosmetic failure');
			};
		}

		await runtime.computer('type', undefined, async () => {
			expect(companion.state.interactionLocked).toBe(true);
			events.push('input');
			return jsonResult({ok: true});
		});
		expect(events).toEqual(['lock:true', 'input', 'lock:false']);
		expect(companion.state.completedActions).toBe(1);
	});

	it('checks pause again after awaiting the safety lock', async () => {
		const {runtime, companion, events} = fixture();
		companion.update = async (patch) => {
			Object.assign(companion.state, patch);
			companion.state.paused = true;
		};

		await expect(runtime.computer('type', undefined, async () => {
			events.push('input');
			return jsonResult({ok: true});
		})).rejects.toThrow('Computer action cancelled or paused before execution.');
		expect(events).not.toContain('input');
		expect(companion.state.interactionLocked).toBe(false);
	});
});
