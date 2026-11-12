import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {serialize, timedCall} from '../utils/timing.js';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import {errorResult, rejectedAction} from '../utils/errors.js';
import {
	runWindowsBatch, runWindowsRequest, validateWindowsRequest, windowsActions, windowsFields, windowsStepSchema,
} from '../windows/batch.js';

export function registerWindows(server: McpServer, runtime: PokemonRuntime): void {
	if (!['win32', 'darwin', 'linux'].includes(process.platform)) {
		return;
	}

	server.registerTool('windows', {
		title: 'Desktop UI Automation (Cross-Platform)',
		description: 'PREFERRED for desktop control: native Win32/UIA on Windows; macOS/Linux use the separately installed agent-desktop JSON contract 2.6 bridge. Compact text, no screenshots. Window tokens, skeleton/subtree reads and state/absence waits require Windows. macOS/Linux select and URL/path launch are unsupported; saved read_text may not be live. Element ref @s<snapshot>:e<element_id> is supported alongside explicit snapshot/element_id. Use desktop status for readiness. Preserve window_ref from discovery. get_ui view=skeleton lists named containers; use root_snapshot/root_element_id for subtree reads. wait_condition supports presence, absence, enabled/disabled and selected/unselected; absence requires a prior complete unique snapshot/element_id and an exact stable name or automation ID. Waits stay pinned to the observed window. Retry only when error_details.disposition.retry is safe; for batches this applies only to stopped_step, never completed steps. Refresh discovery on STALE_REF and respect user pauses. Batch is the default mode: provide steps and omit action, or set action=batch (1-16 sequential steps): discover an app/control, act, then get_ui to verify, in one call. Steps use atomic actions; window_step references an earlier zero-based get_windows/launch (exactly one untruncated window) or get_ui/wait_for; target_step references an earlier get_ui/wait_for (exactly one untruncated control supporting the action). Example steps: get_windows(query), get_ui(window_step:0,query,control_type:Edit), set_value(target_step:1,text), get_ui(window_step:0,query,expect_value:text). Batch returns only the final result/count, or stops with failing step and diagnostics; completed steps are not rolled back. No retries of inputs. wait_for polls query/control_type (optionally expect_value) until timeout_ms (default 5000, max 15000). launch starts text as an executable name/path or http/https URL via the OS and waits for a window; URLs require query, and shell commands/arguments are unsupported. For URLs, query by the browser process name rather than the page title, which can change while loading. Both work in batch. matched is a lower bound when truncated. After an interrupted wait, call get_ui again for fresh snapshots. Batch each chosen action with get_ui or wait_for; interpret the returned observation before choosing the next segment. Filter query/name/control_type and keep max_chars small. If get_ui returns only title-bar buttons, call activate on the window first, then get_ui again (Electron/Chromium apps expose their controls only after activation). max_chars must be <= 16000. expect_value is limited to 160 chars; for long values use read_text. get_ui values can be clipped even when truncated=false; use read_text to get the full text of a field. After navigation or invoke, the first read may show the previous view; re-read once before concluding. Atomic actions use window_id from get_windows and snapshot + element_id from get_ui. invoke clicks through API; set_value fills; select chooses a tab/item. Re-read after changes. IDs expire after two minutes; never guess them. If a control lacks API support, use computer keyboard shortcuts, then screenshots only as necessary. Shortcuts: use windows focus/invoke/set_value and batch first. Use a known direct shortcut (ctrl+l address bar, ctrl+1..8 indexed tab, ctrl+9 last tab, escape dismiss, ctrl+, settings where supported) only when no control is exposed or no UIA pattern fits; on Windows pass window_id for the foreground guard and verify the result immediately. Never use tab/ctrl+tab/alt+tab as blind navigation.',
		inputSchema: z.object({
			action: z.enum(['batch', ...windowsActions]).default('batch').describe('Defaults to batch: supply 1-16 known steps, including observation after input. Decide the next segment from that result. Use atomic when only one step is known.'),
			...windowsFields,
			steps: z.array(windowsStepSchema).min(1).max(16).optional().describe('Required for the default batch mode. Whole batch is exclusive; stops on ambiguity, errors, pause or cancellation. Top-level max_chars bounds the entire response.'),
		}).strict(),
		annotations: {readOnlyHint: false},
	}, async (args, extra) => timedCall('windows', args.action, async () => {
		try {
			if (args.action === 'batch') {
				if (!args.steps) {
					throw rejectedAction('INVALID_ARGS', 'batch requires steps.');
				}

				return await runWindowsBatch(runtime, args.steps, args.max_chars, extra.signal);
			}

			if (args.steps !== undefined) {
				throw rejectedAction('INVALID_ARGS', 'steps are supported only with action=batch.');
			}

			if (args.expect_value !== undefined && args.action !== 'wait_for') {
				throw rejectedAction('INVALID_ARGS', 'expect_value is supported atomically only by wait_for; use batch for a get_ui expectation.');
			}

			validateWindowsRequest(args);

			const activity = args.action === 'read_text' ? 'get_ui_text' : args.action;
			return await runtime.computer(activity, undefined, async () => {
				const result = await runWindowsRequest(runtime, args, extra.signal);
				return {content: [{type: 'text' as const, text: serialize(result)}]};
			}, extra.signal);
		} catch (error) {
			return errorResult(error, args.max_chars);
		}
	}));
}
