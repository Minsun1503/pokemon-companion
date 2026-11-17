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
import {registerResearch} from './research.js';
import {registerBrowser} from './browser.js';
import {registerAppInspect} from './app-inspect.js';
import {registerApp} from './app.js';
import {registerAssistant} from './assistant.js';
import {registerApi} from './api.js';

export function registerAll(server: McpServer, runtime: PokemonRuntime): void {
	const traced = instrument(server, runtime.learning);
	registerDesktop(traced, runtime);
	registerComputer(traced, runtime);
	registerPokemon(traced, runtime);
	registerWindows(traced, runtime);
	registerCourse(traced, runtime);
	registerResearch(traced, runtime);
	registerBrowser(traced, runtime);
	registerApi(traced, runtime);
	registerAppInspect(traced, runtime);
	registerApp(traced, runtime);
	registerAssistant(traced, runtime);
	registerExcel(traced, runtime);
	registerLearning(server, runtime);
}
