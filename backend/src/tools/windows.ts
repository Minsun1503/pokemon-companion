import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import type {PokemonRuntime} from '../pokemon/runtime.js';

export function registerWindows(server: McpServer, runtime: PokemonRuntime): void {
	if (process.platform !== 'win32') {
		return;
	}

	server.registerTool('windows', {
		title: 'Windows API Control',
		description: 'PREFERRED on Windows: inspect and operate apps through Win32 and UI Automation with compact text and no screenshots. Start with get_windows, choose its window_id, then get_ui. Filter query/name or control_type and keep max_chars small to save tokens. Use snapshot + element_id from get_ui for supported actions. invoke clicks a control through its API; set_value fills a field; select chooses a tab/item; read_text reads text. Re-read get_ui after changes to verify results. activate brings a window forward. If an app does not expose a control/pattern, use computer keyboard shortcuts, then a screenshot only when necessary. Element ids belong to their snapshot and expire after two minutes; never guess them.',
		inputSchema: z.object({
			action: z.enum(['get_windows', 'get_ui', 'activate', 'invoke', 'set_value', 'select', 'toggle', 'expand', 'collapse', 'scroll', 'focus', 'read_text']),
			window_id: z.string().regex(/^\d+$/).optional(),
			query: z.string().max(200).optional().describe('Case-insensitive name/automation-id filter; get_windows also matches process names.'),
			control_type: z.string().max(50).optional().describe('Optional role, e.g. Button, Edit, TabItem, Text.'),
			max_elements: z.number().int().min(1).max(250).default(60),
			max_depth: z.number().int().min(1).max(30).default(24),
			max_chars: z.number().int().min(1000).max(16000).default(6000),
			snapshot: z.string().regex(/^[a-f0-9]{32}$/).optional(),
			element_id: z.number().int().positive().optional(),
			text: z.string().max(8000).optional(),
			direction: z.enum(['up', 'down', 'left', 'right']).optional(),
		}).strict(),
		annotations: {readOnlyHint: false},
	}, async (args, extra) => {
		if (['get_ui', 'activate'].includes(args.action) && !args.window_id) {
			throw new Error(`${args.action} requires window_id from get_windows.`);
		}

		if (!['get_windows', 'get_ui', 'activate'].includes(args.action) && (!args.snapshot || !args.element_id)) {
			throw new Error(`${args.action} requires snapshot and element_id from get_ui.`);
		}

		if (args.action === 'set_value' && args.text === undefined) {
			throw new Error('set_value requires text (an empty string clears the field).');
		}

		if (args.action === 'scroll' && !args.direction) {
			throw new Error('scroll requires direction.');
		}

		const activity = args.action === 'read_text' ? 'get_ui_text' : args.action;
		return runtime.computer(activity, undefined, async () => {
			const result = await runtime.windows.request(args);
			return {content: [{type: 'text' as const, text: JSON.stringify(result)}]};
		}, extra.signal);
	});
}
