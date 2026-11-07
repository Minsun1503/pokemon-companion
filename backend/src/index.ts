// Library exports for programmatic usage
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registerAll} from './tools/index.js';
import {PokemonRuntime} from './pokemon/runtime.js';

export function createServer(runtime?: PokemonRuntime): McpServer {
	const ownedRuntime = runtime || new PokemonRuntime();
	const server = new McpServer({
		name: 'pokemon-computer-use',
		version: '1.8.0',
	});

	registerAll(server, ownedRuntime);
	if (!runtime) {
		server.server.onclose = () => {
			void ownedRuntime.close();
		};
	}

	return server;
}
