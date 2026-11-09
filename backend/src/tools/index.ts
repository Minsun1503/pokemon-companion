import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registerComputer} from './computer.js';
import {registerPokemon} from './pokemon.js';
import {registerWindows} from './windows.js';
import {registerCourse} from './course.js';
import {registerExcel} from './excel.js';
import type {PokemonRuntime} from '../pokemon/runtime.js';

export function registerAll(server: McpServer, runtime: PokemonRuntime): void {
	registerComputer(server, runtime);
	registerPokemon(server, runtime);
	registerWindows(server, runtime);
	registerCourse(server, runtime);
	registerExcel(server, runtime);
}
