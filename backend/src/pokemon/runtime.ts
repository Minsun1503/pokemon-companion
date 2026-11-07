import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {type Companion, DesktopCompanion, type PokemonState} from './companion.js';
import {WindowsAutomation} from '../windows/automation.js';

const labels: Record<string, string> = {
	key: 'Using a keyboard shortcut', type: 'Typing', mouse_move: 'Moving to the target',
	left_click: 'Clicking', left_click_drag: 'Dragging', right_click: 'Opening a context menu',
	middle_click: 'Middle clicking', double_click: 'Opening this', scroll: 'Scrolling',
	get_screenshot: 'Looking at your screen', get_cursor_position: 'Checking the cursor',
	get_windows: 'Finding your app', get_ui: 'Reading app controls', get_ui_text: 'Reading app text',
	invoke: 'Using an app control', set_value: 'Filling a field', select: 'Selecting an item',
	activate: 'Switching to your app', focus: 'Focusing a field', toggle: 'Toggling a control',
	expand: 'Expanding a control', collapse: 'Collapsing a control',
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
		const result = this.queue.then(run);
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
			await this.companion.update(patch);
			return {...this.companion.state};
		});
	}

	private async executeComputer(action: string, coordinate: number[] | undefined, execute: () => Promise<CallToolResult>, signal?: AbortSignal): Promise<CallToolResult> {
		await this.companion.start();
		if (signal?.aborted) {
			throw new Error('Computer action cancelled.');
		}

		if (this.companion.state.paused) {
			throw new Error('Computer control is paused by the user. Ask them to resume from the Pokémon tray or Ctrl+Shift+P.');
		}

		await this.companion.update({activity: action.startsWith('get_') ? 'thinking' : 'working', message: labels[action] || action, interactionLocked: true}, coordinate);
		try {
			if (action === 'get_screenshot') {
				await this.companion.capture(true);
			}

			if (signal?.aborted || this.companion.state.paused) {
				throw new Error('Computer action cancelled or paused before execution.');
			}

			const result = await execute();
			if (result.isError) {
				throw new Error(result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'));
			}

			await this.companion.update({activity: this.companion.state.task ? 'working' : 'idle', completedActions: this.companion.state.completedActions + 1, interactionLocked: false});
			return result;
		} catch (error) {
			await this.companion.update({activity: 'error', message: error instanceof Error ? error.message : String(error), interactionLocked: false});
			throw error;
		} finally {
			if (action === 'get_screenshot') {
				await this.companion.capture(false);
			}
		}
	}
}
