// Library exports for programmatic usage
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registerAll} from './tools/index.js';
import {PokemonRuntime} from './pokemon/runtime.js';
import {serverVersion} from './version.js';
import {learningInstructions} from './learning/instructions.js';
export {courseSchema, runCourse} from './windows/course.js';
export type {CourseRequest} from './windows/course.js';
export {excelSchema, runExcel} from './windows/excel.js';
export type {ExcelRequest} from './windows/excel.js';

export function createServer(runtime?: PokemonRuntime): McpServer {
	const ownedRuntime = runtime || new PokemonRuntime();
	const server = new McpServer({
		name: 'pokemon-computer-use',
		version: serverVersion,
	}, {instructions: `${learningInstructions}On Windows, use windows UI Automation with batch as the default mode: provide steps and omit the top-level action, or set action=batch. Group known discovery, actions and verification in 1-16 sequential steps; use an explicit atomic action when the next step needs judgment. Use desktop status for readiness. Preserve window_ref from discovery. get_ui view=skeleton lists named containers; use root_snapshot/root_element_id for subtree reads. wait_condition supports presence, absence, enabled/disabled and selected/unselected; absence requires a prior complete unique snapshot/element_id and an exact stable name or automation ID. Waits stay pinned to the observed window. Retry only when error_details.disposition.retry is safe; for batches this applies only to stopped_step, never completed steps. Refresh discovery on STALE_REF and respect user pauses. Use wait_for to poll controls or exact values with a bounded timeout. Use launch with text containing an executable name/path or http/https URL and query identifying the window; shell commands and arguments are unsupported. matched is a lower bound when truncated. After an interrupted wait, call get_ui again for fresh snapshots. Verify results before marking pokemon done and respect user pauses. Shortcuts: use windows focus/invoke/set_value and batch first. Use a known direct shortcut (ctrl+l address bar, ctrl+1..8 indexed tab, ctrl+9 last tab, escape dismiss, ctrl+, settings where supported) only when no control is exposed or no UIA pattern fits; on Windows pass window_id for the foreground guard and verify the result immediately. Never use tab/ctrl+tab/alt+tab as blind navigation.`});

	registerAll(server, ownedRuntime);
	if (!runtime) {
		server.server.onclose = () => {
			void ownedRuntime.close();
		};
	}

	return server;
}
