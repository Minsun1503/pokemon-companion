import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {type Companion, DesktopCompanion, type PokemonState} from './companion.js';
import {WindowsAutomation} from '../windows/automation.js';
import {performance} from 'node:perf_hooks';
import {measure, recordTiming} from '../utils/timing.js';

const labels: Record<string, string> = {
	key: 'Using a keyboard shortcut', type: 'Typing', mouse_move: 'Moving to the target',
	left_click: 'Clicking', left_click_drag: 'Dragging', right_click: 'Opening a context menu',
	middle_click: 'Middle clicking', double_click: 'Opening this', scroll: 'Scrolling',
	get_screenshot: 'Looking at your screen', get_cursor_position: 'Checking the cursor',
	get_windows: 'Finding your app', get_ui: 'Reading app controls', get_ui_text: 'Reading app text',
	invoke: 'Using an app control', set_value: 'Filling a field', select: 'Selecting an item',
	activate: 'Switching to your app', focus: 'Focusing a field', toggle: 'Toggling a control',
	expand: 'Expanding a control', collapse: 'Collapsing a control',
	wait_for: 'Waiting for an app control', launch: 'Opening your app',
};

export class PokemonRuntime {
	readonly windows = new WindowsAutomation();
	private queue: Promise<unknown> = Promise.resolve();
	constructor(readonly companion: Companion = new DesktopCompanion()) {}

	async close(): Promise<void> {
		this.windows.close();
		await this.companion.close();
	}

	/** Serialize all input and character commands across clients sharing this desktop. */
	async exclusive<T>(run: () => Promise<T>): Promise<T> {
		const queued = performance.now();
		const result = this.queue.then(async () => {
			recordTiming('queue_wait', performance.now() - queued);
			return run();
		});
		this.queue = result.catch(() => undefined);
		return result;
	}

	async computer(action: string, coordinate: number[] | undefined, execute: () => Promise<CallToolResult>, signal?: AbortSignal): Promise<CallToolResult> {
		return this.exclusive(async () => this.executeComputer(action, coordinate, execute, signal));
	}

	/** Keep a whole sequence exclusive while checking pause/cancellation before every step. */
	async computerBatch(run: (perform: (action: string, execute: () => Promise<CallToolResult>) => Promise<CallToolResult>) => Promise<CallToolResult>, signal?: AbortSignal): Promise<CallToolResult> {
		return this.exclusive(async () => run(async (action, execute) => this.executeComputer(action, undefined, execute, signal)));
	}

	async update(patch: Partial<PokemonState>): Promise<PokemonState> {
		return this.exclusive(async () => {
			await measure('companion_before', async () => this.companion.update(patch));
			return {...this.companion.state};
		});
	}

	private async executeComputer(action: string, coordinate: number[] | undefined, execute: () => Promise<CallToolResult>, signal?: AbortSignal): Promise<CallToolResult> {
		await measure('companion_before', async () => this.companion.start());
		if (signal?.aborted) {
			throw new Error('Computer action cancelled.');
		}

		if (this.companion.state.paused) {
			throw new Error('Computer control is paused by the user. Ask them to resume from the Pokémon tray or Ctrl+Shift+P.');
		}

		await measure('companion_before', async () => this.companion.update({interactionLocked: true}));
		this.animate({activity: action.startsWith('get_') ? 'thinking' : 'working', message: labels[action] || action}, coordinate);
		try {
			if (action === 'get_screenshot') {
				await measure('companion_before', async () => measure('capture_hide', async () => this.companion.capture(true)));
			}

			if (signal?.aborted || this.companion.state.paused) {
				throw new Error('Computer action cancelled or paused before execution.');
			}

			const result = await measure('action', execute);
			if (result.isError) {
				throw new Error(result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'));
			}

			this.animate({activity: this.companion.state.task ? 'working' : 'idle', completedActions: this.companion.state.completedActions + 1});
			return result;
		} catch (error) {
			this.animate({activity: 'error', message: error instanceof Error ? error.message : String(error)});
			throw error;
		} finally {
			try {
				await measure('companion_after', async () => this.companion.update({interactionLocked: false}));
			} finally {
				if (action === 'get_screenshot') {
					await measure('companion_after', async () => measure('capture_show', async () => this.companion.capture(false)));
				}
			}
		}
	}

	private animate(patch: Partial<PokemonState>, coordinate?: number[]): void {
		Object.assign(this.companion.state, patch);
		try {
			if (this.companion.animate) {
				this.companion.animate(patch, coordinate);
			} else {
				void this.companion.update(patch, coordinate).catch(() => undefined);
			}
		} catch {/* Custom companions may throw synchronously on cosmetic updates. */}
	}
}
