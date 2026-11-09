import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import {courseSchema, runCourse} from '../windows/course.js';
import {timedCall} from '../utils/timing.js';

export function registerCourse(server: McpServer, runtime: PokemonRuntime): void {
	if (process.platform !== 'win32') {
		return;
	}

	server.registerTool('course', {
		title: 'Course Navigation and Reading',
		description: 'Focused Windows UI Automation helpers for learning pages: read_lesson returns versioned text pages; open_lesson invokes one exact observed lesson control, waits for changed text with a unique ready_text, then reads; search_courses fills one exact search field, verifies it, waits for a unique result marker, then reads; check_completion checks a specific completion message in the selected course Document. Start with windows get_windows/get_ui to identify window_id and exact names. These helpers require visible controls; scroll with windows first if absent. They never answer quizzes, press Finish automatically, take screenshots or retry inputs. Read long lessons with offset=next_offset and the original version; if text changed, restart at offset 0. source_truncated means the native one-million-character bound was reached. Completion evidence concerns only the chosen message, not reading coverage. One call is exclusive, pause/cancellation-aware and bounded to 15 seconds; failures report phase and input_state (not_sent/applied/unknown). Use current user authorisation for navigation/search side effects.',
		inputSchema: courseSchema,
		annotations: {readOnlyHint: false},
	}, async (args, extra) => timedCall('course', args.action, async () => runCourse(runtime, args, extra.signal)));
}
