// Library exports for programmatic usage
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registerAll} from './tools/index.js';
import {PokemonRuntime} from './pokemon/runtime.js';

export function createServer(runtime?: PokemonRuntime): McpServer {
	const ownedRuntime = runtime || new PokemonRuntime();
	const server = new McpServer({
		name: 'pokemon-computer-use',
		version: '1.8.0',
	}, {instructions: 'On Windows, prefer windows UI Automation and batch known sequences. Use wait_for to poll controls or exact values with a bounded timeout. Use launch with text containing an executable name/path or http/https URL and query identifying the window; shell commands and arguments are unsupported. matched is a lower bound when truncated. After an interrupted wait, call get_ui again for fresh snapshots. Verify results before marking pokemon done and respect user pauses. Shortcuts: use a known direct shortcut (ctrl+l address bar, ctrl+1..8 indexed tab, ctrl+9 last tab, escape dismiss, ctrl+, settings where supported) only after verifying the target is foreground, then verify the result immediately. Never use tab/ctrl+tab/alt+tab as blind navigation. Use windows focus for a known control.'});

	registerAll(server, ownedRuntime);
	if (!runtime) {
		server.server.onclose = () => {
			void ownedRuntime.close();
		};
	}

	return server;
}
