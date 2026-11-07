// Library exports for programmatic usage
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registerAll} from './tools/index.js';
import {PokemonRuntime} from './pokemon/runtime.js';

export function createServer(runtime?: PokemonRuntime): McpServer {
	const ownedRuntime = runtime || new PokemonRuntime();
	const server = new McpServer({
		name: 'pokemon-computer-use',
		version: '1.8.0',
	}, {instructions: 'On Windows, prefer windows UI Automation and batch known sequences. Use wait_for to poll controls or exact values with a bounded timeout. Use launch with text containing an executable name/path or http/https URL and query identifying the window; shell commands and arguments are unsupported. matched is a lower bound when truncated. After an interrupted wait, call get_ui again for fresh snapshots. Verify results before marking pokemon done and respect user pauses.'});

	registerAll(server, ownedRuntime);
	if (!runtime) {
		server.server.onclose = () => {
			void ownedRuntime.close();
		};
	}

	return server;
}
