import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {pokemonIds, type PokemonState} from '../pokemon/companion.js';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import {jsonResult} from '../utils/response.js';
import {measure, timedCall} from '../utils/timing.js';

export function registerPokemon(server: McpServer, runtime: PokemonRuntime): void {
	server.registerTool('pokemon', {
		title: 'Pokémon Companion',
		description: 'Present an animated Pokémon on the user’s desktop while you work. Start a task with action=task and a short message; select any of the seven pets; say short progress updates; finish with done or error. Computer actions automatically animate the selected Pokémon. status reports the user-controlled pause state. You cannot resume a user pause: ask the user to use the tray or Ctrl+Shift+P. Never claim a task is done until you have verified its result.',
		inputSchema: z.object({
			action: z.enum(['status', 'select', 'say', 'task', 'think', 'done', 'error', 'show', 'hide']),
			pet: z.enum(pokemonIds).optional(),
			message: z.string().trim().min(1).max(240).optional(),
		}).strict(),
		annotations: {readOnlyHint: false},
	}, async ({action, pet, message}) => timedCall('pokemon', action, async () => {
		if (action === 'status') {
			await measure('companion_before', async () => runtime.companion.start());
			return jsonResult({...runtime.companion.state, availablePets: [...pokemonIds]});
		}

		if (action === 'select' && !pet) {
			throw new Error('select requires pet.');
		}

		if (['task', 'say', 'error'].includes(action) && !message) {
			throw new Error(`${action} requires message.`);
		}

		const patch: Partial<PokemonState> = action === 'select'
			? {pet: pet!}
			: action === 'show' || action === 'hide'
				? {visible: action === 'show'}
				: action === 'task'
					? {
						task: message!, message: message!, activity: 'working' as const, completedActions: 0,
					}
					: action === 'done'
						? {task: '', message: message || 'All done!', activity: 'success' as const}
						: action === 'error'
							? {task: '', message: message!, activity: 'error' as const}
							: action === 'think'
								? {message: message || 'Thinking about the next step…', activity: 'thinking' as const}
								: {message: message!};
		return jsonResult(await runtime.update(patch));
	}));
	server.registerPrompt('pokemon-work', {
		title: 'Work with your Pokémon',
		description: 'Use the desktop companion to narrate and animate computer work.',
	}, () => ({messages: [{role: 'user', content: {type: 'text', text: 'Use pokemon to announce the task. On Windows, prefer windows action=batch for known sequences to reduce AI exchanges: get_windows, get_ui with narrow filters, supported API actions, and a final UI read or expect_value check. Use wait_for to poll a control or exact value until a bounded timeout. Use launch to start an executable name/path or http/https URL via the OS and wait for its window (URLs require query; no shell commands or arguments). Use zero-based window_step and target_step references to earlier discovery steps; never select ambiguous/truncated matches or guess ids. Batches stop at the first failure and do not undo completed actions; inspect completed/stopped_step before continuing and never replay completed inputs blindly. Use atomic calls when the next action needs your judgment. Keep results compact and progress brief. If UI Automation is insufficient, use computer keyboard shortcuts; screenshots and coordinate clicks are a last resort. Screenshot coordinates use the supplied image dimensions. Mark done only after verifying results. Respect user pauses. Select my preferred Pokémon when asked. Shortcuts: use a known direct shortcut (ctrl+l address bar, ctrl+1..8 indexed tab, ctrl+9 last tab, escape dismiss, ctrl+, settings where supported) only after verifying the target is foreground, then verify the result immediately. Never use tab/ctrl+tab/alt+tab as blind navigation. Use windows focus for a known control.'}}]}));
}
