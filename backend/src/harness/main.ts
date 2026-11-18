import {execFile} from 'node:child_process';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {LocalJournal} from '../learning/privacy.js';
import {harnessHome, loadConfig} from './config.js';
import {HarnessStore} from './store.js';
import {GatewayApprovals} from './approvals.js';
import {HarnessEngine} from './engine.js';
import {harnessRuntime} from './runtime.js';
import {TelegramGateway} from './telegram.js';
import {setupApp} from './setup-server.js';

export async function main(mode: string, root: string) {
	let deepSeekOnly = false;
	try {
		const profile = JSON.parse(await readFile(join(root, 'agent-profile.json'), 'utf8')) as {id: string};
		if (profile.id !== 'deepseek-telegram') {
			throw new Error('Unknown agent deployment profile.');
		}

		deepSeekOnly = true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
	}

	if (deepSeekOnly && !process.env.POKEMON_HARNESS_HOME) {
		process.env.POKEMON_HARNESS_HOME = join(process.env.LOCALAPPDATA || homedir(), 'pokemon-companion', 'harness-deepseek');
	}

	const home = harnessHome();
	const config = await loadConfig(home, deepSeekOnly);
	if (mode === 'init') {
		console.log(`Pokémon Agent configuration: ${join(home, 'config.json')}\nRun npm run agent -- setup to enter provider keys and connect Telegram.`);
		return;
	}

	const store = new HarnessStore(new LocalJournal(join(home, 'store')));
	await store.open();
	if (mode === 'status') {
		console.log(JSON.stringify({
			runtime: 'pokemon-agent', home, desktopRelay: config.desktopRelay, defaultRoute: config.defaultRoute, routes: Object.entries(config.routes).map(([id, route]) => ({id, model: route.model, keyConfigured: Boolean(store.secret(route.keyEnv))})), telegram: {enabled: config.telegram.enabled, ownersConfigured: config.telegram.allowedUsers.length, tokenConfigured: Boolean(store.secret('TELEGRAM_BOT_TOKEN'))},
		}, null, 2));
		await store.close();
		return;
	}

	if (!['setup', 'run', 'check'].includes(mode)) {
		await store.close();
		throw new Error('Use init, setup, run, status, or check.');
	}

	process.env.POKEMON_FRONTEND_DIR = join(root, 'frontend');
	process.env.POKEMON_ACTIONS_DIR = join(home, 'actions');
	process.env.POKEMON_LEARNING_DIR = join(home, 'learning');
	process.env.POKEMON_WEB_PROFILE = join(home, 'browser');
	process.env.POKEMON_USER_DATA_DIR = join(home, 'companion');
	process.env.POKEMON_CONNECTIONS_FILE = join(home, 'connections.json');
	const approvals = new GatewayApprovals();
	const tools = await harnessRuntime(approvals);
	const engine = new HarnessEngine(config, store, approvals, tools);
	if (mode === 'check') {
		const definitions = await tools.list();
		const status = await tools.call('desktop', {action: 'status'}, new AbortController().signal);
		console.log(JSON.stringify({runtime: 'pokemon-agent', tools: definitions.map((tool) => tool.name), desktop: status}, null, 2));
		await tools.close();
		await store.close();
		return;
	}

	let gateway: TelegramGateway | undefined;
	let poll: Promise<void> | undefined;
	const connect = async () => {
		approvals.setDesktopGrant(config.desktopRelay?.enabled && config.desktopRelay.approval === 'scoped_grant' ? config.desktopRelay.conversation : undefined, config.telegram.allowedUsers);
		gateway?.stop();
		await poll?.catch(() => undefined);
		gateway = undefined;
		if (config.telegram.enabled) {
			gateway = new TelegramGateway(engine, store.secret('TELEGRAM_BOT_TOKEN'), new Set(config.telegram.allowedUsers), undefined, new Set(config.telegram.allowedGroups));
			poll = gateway.run().catch((error: unknown) => {
				console.error(error instanceof Error ? error.message : 'Telegram startup failed.');
			});
		}
	};

	await connect();
	const {app, token, settled} = setupApp({
		deepSeekOnly,
		inspectDesktop: async (current) => tools.call('assistant', {action: 'inspect', ...(current ? {} : {conversation: config.desktopRelay?.conversation})}, AbortSignal.timeout(30000)),
		home, config, store, busy: () => engine.busy, telegramStatus: () => gateway?.connected ? 'connected' : (config.telegram.enabled ? 'connecting or unavailable' : 'not connected'), changed: connect,
		setConfiguring(value) {
			engine.configuring = value;
		},
	});
	const server = app.listen(Number(process.env.POKEMON_HARNESS_PORT || 0), '127.0.0.1', () => {
		const address = server.address();
		if (address && typeof address !== 'string') {
			const url = `http://127.0.0.1:${address.port}/#${token}`;
			console.log(`POKEMON_AGENT_READY ${url}`);
			if (mode === 'setup' && process.env.POKEMON_AGENT_NO_OPEN !== '1') {
				const program = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
				const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
				execFile(program, args, {windowsHide: true}, (error) => {
					if (error) {
						console.error('Open the local setup URL above in your browser.');
					}
				});
			}
		}
	});
	let closing = false;
	const close = async () => {
		if (closing) {
			return;
		}

		closing = true;
		server.close();
		gateway?.stop();
		await settled();
		gateway?.stop();
		await poll?.catch(() => undefined);
		await engine.close();
		await tools.close();
		await store.close();
	};

	process.once('SIGINT', () => {
		void close();
	});
	process.once('SIGTERM', () => {
		void close();
	});
}
