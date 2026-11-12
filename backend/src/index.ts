// Library exports for programmatic usage
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registerAll} from './tools/index.js';
import {PokemonRuntime} from './pokemon/runtime.js';
import {serverVersion} from './version.js';
import {desktopInstructions, learningInstructions, researchInstructions} from './learning/instructions.js';
export {courseSchema, runCourse} from './windows/course.js';
export type {CourseRequest} from './windows/course.js';
export {excelSchema, runExcel} from './windows/excel.js';
export type {ExcelRequest} from './windows/excel.js';

export function createServer(runtime?: PokemonRuntime): McpServer {
	const ownedRuntime = runtime || new PokemonRuntime();
	const server = new McpServer({
		name: 'pokemon-computer-use',
		version: serverVersion,
	}, {instructions: `${learningInstructions}${researchInstructions}${desktopInstructions}`});

	registerAll(server, ownedRuntime);
	if (!runtime) {
		server.server.onclose = () => {
			void ownedRuntime.close();
		};
	}

	return server;
}
