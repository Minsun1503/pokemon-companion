import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {serialize, timedCall} from '../utils/timing.js';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import {
	runWindowsBatch, runWindowsRequest, validateWindowsRequest, windowsActions, windowsFields, windowsStepSchema,
} from '../windows/batch.js';

export function registerWindows(server: McpServer, runtime: PokemonRuntime): void {
	if (!['win32', 'darwin', 'linux'].includes(process.platform)) {
		return;
	}

	server.registerTool('windows', {
		title: 'Desktop UI Automation (Cross-Platform)',
		description: 'PREFERRED for desktop control across Windows, macOS, and Linux (native Win32/UIA on Windows; macOS/Linux require agent-desktop JSON contract 2.6 installed on PATH): Compact text, no screenshots. Prefer action=batch for known sequences (1-16 sequential steps): discover an app/control, act, then get_ui to verify, in one call. Steps use atomic actions; window_step references an earlier zero-based get_windows/launch (exactly one untruncated window) or get_ui/wait_for; target_step references an earlier get_ui/wait_for (exactly one untruncated control supporting the action). Example steps: get_windows(query), get_ui(window_step:0,query,control_type:Edit), set_value(target_step:1,text), get_ui(window_step:0,query,expect_value:text). Batch returns only the final result/count, or stops with failing step and diagnostics; completed steps are not rolled back. No retries of inputs. wait_for polls query/control_type (optionally expect_value) until timeout_ms (default 5000, max 15000). launch waits for a window: Windows accepts an executable name/path or http/https URL (URLs require query); macOS/Linux accept an application name only. Atomic actions use window_id from get_windows and snapshot + element_id (or ref: "@s<snapshot>:e<element_id>") from get_ui. invoke clicks through API; set_value fills; select chooses a tab/item on Windows and is unsupported on macOS/Linux. Native policies may reject other actions; errors are propagated without input retries. macOS/Linux read_text may return saved snapshot text. get_ui values can be clipped; value_clipped prevents exact-value verification. Re-read after changes. IDs expire after two minutes; never guess them. If a control lacks API support, use computer keyboard shortcuts, then screenshots only as necessary.',
		inputSchema: z.object({
			action: z.enum([...windowsActions, 'batch']),
			...windowsFields,
			steps: z.array(windowsStepSchema).min(1).max(16).optional().describe('Required only for batch. Whole batch is exclusive; stops on ambiguity, errors, pause or cancellation. Top-level max_chars bounds the entire response.'),
		}).strict(),
		annotations: {readOnlyHint: false},
	}, async (args, extra) => timedCall('windows', args.action, async () => {
		if (args.action === 'batch') {
			if (!args.steps) {
				throw new Error('batch requires steps.');
			}

			return runWindowsBatch(runtime, args.steps, args.max_chars, extra.signal);
		}

		if (args.steps !== undefined) {
			throw new Error('steps are supported only with action=batch.');
		}

		if (args.expect_value !== undefined && args.action !== 'wait_for') {
			throw new Error('expect_value is supported atomically only by wait_for; use batch for a get_ui expectation.');
		}

		validateWindowsRequest(args);

		const activity = args.action === 'read_text' ? 'get_ui_text' : args.action;
		return runtime.computer(activity, undefined, async () => {
			const result = await runWindowsRequest(runtime, args, extra.signal);
			return {content: [{type: 'text' as const, text: serialize(result)}]};
		}, extra.signal);
	}));
}
