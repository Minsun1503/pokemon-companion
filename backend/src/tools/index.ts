import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registerComputer} from './computer.js';
import {registerPokemon} from './pokemon.js';
import {registerWindows} from './windows.js';
import {registerCourse} from './course.js';
import {registerExcel} from './excel.js';
import {registerDesktop} from './desktop.js';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import {instrument} from '../learning/instrument.js';
import {registerLearning} from './learning.js';

export function registerAll(server: McpServer, runtime: PokemonRuntime): void {
	const traced = instrument(server, runtime.learning);
	registerDesktop(traced, runtime);
	registerComputer(traced, runtime);
	registerPokemon(traced, runtime);
	registerWindows(traced, runtime);
	registerCourse(traced, runtime);
	registerExcel(traced, runtime);
	registerLearning(server, runtime);
}
