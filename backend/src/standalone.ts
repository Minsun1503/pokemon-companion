import {DesktopCompanion} from './pokemon/companion.js';
import {PokemonRuntime} from './pokemon/runtime.js';

// The standalone app owns the companion bridge without exposing an MCP HTTP server.
let stopping = false;
const companion = new DesktopCompanion(() => {
	void stop(0);
});
const runtime = new PokemonRuntime(companion);

async function stop(code: number): Promise<void> {
	if (stopping) {
		return;
	}

	stopping = true;
	try {
		await runtime.close();
	} finally {
		process.exit(code);
	}
}

process.on('SIGINT', () => {
	void stop(0);
});
process.on('SIGTERM', () => {
	void stop(0);
});
runtime.windows.warm();
void companion.start().then(() => {
	console.log('Pokémon Companion is ready. Click the Pokémon to switch companions or exit.');
	if (process.argv.includes('--smoke-test')) {
		void stop(0);
	}
}).catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	void stop(1);
});
