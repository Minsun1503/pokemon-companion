import {it, expect} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {join, resolve, relative} from 'node:path';
import {tmpdir} from 'node:os';
import {LocalJournal} from '../learning/privacy.js';
import {defaultConfig} from './config.js';
import {HarnessStore} from './store.js';
import {checkModelConnection, checkTelegramConnection, setTelegramDisplayName} from './connections.js';
import {setupApp} from './setup-server.js';

it('checks saved model credentials and the fixed Telegram group without generation, polling or messages', async () => {
	const home = await mkdtemp(join(tmpdir(), 'pokemon-connections-'));
	const inside = relative(resolve(tmpdir()), resolve(home));
	if (inside.startsWith('..') || !inside.startsWith('pokemon-connections-')) {
		throw new Error('Unexpected fixture path.');
	}

	const store = new HarnessStore(new LocalJournal(join(home, 'store'), Buffer.alloc(32, 19)));
	const paths: string[] = [];
	let displayName = 'Long original name';
	const provider = createServer(async (request, response) => {
		paths.push(request.url ?? '');
		response.setHeader('Content-Type', 'application/json');
		if (request.url === '/models' || request.url === '/v1/models') {
			expect(request.headers.authorization ?? request.headers['x-api-key']).toBe(request.url === '/models' ? 'Bearer PRIVATE_API_KEY' : 'PRIVATE_API_KEY');
			response.end(JSON.stringify({data: [{id: 'fixture-model'}, {id: 'sk-PRIVATE_DO_NOT_RETURN'}]}));
		} else if (request.url?.endsWith('/getMe')) {
			response.end(JSON.stringify({
				ok: true, result: {
					id: 77, username: 'fixture_bot', first_name: displayName, can_read_all_group_messages: false,
				},
			}));
		} else if (request.url?.endsWith('/setMyName')) {
			let raw = '';
			for await (const chunk of request) {
				raw += String(chunk);
			}

			displayName = (JSON.parse(raw) as {name: string}).name;
			response.end(JSON.stringify({ok: true, result: true}));
		} else if (request.url?.endsWith('/getMyName')) {
			response.end(JSON.stringify({ok: true, result: {name: displayName}}));
		} else if (request.url?.endsWith('/getWebhookInfo')) {
			response.end(JSON.stringify({ok: true, result: {url: ''}}));
		} else if (request.url?.endsWith('/getChat')) {
			let raw = '';
			for await (const chunk of request) {
				raw += String(chunk);
			}

			expect(JSON.parse(raw)).toEqual({chat_id: '-1001'});
			response.end(JSON.stringify({ok: true, result: {id: -1001, title: 'Fixture PC group', type: 'supergroup'}}));
		} else {
			response.statusCode = 500;
			response.end(JSON.stringify({error: 'PRIVATE_REMOTE_ERROR'}));
		}
	});
	await new Promise<void>((done) => {
		provider.listen(0, '127.0.0.1', done);
	});
	const address = provider.address();
	if (!address || typeof address === 'string') {
		throw new Error('No fixture port.');
	}

	const origin = `http://127.0.0.1:${address.port}`;
	const config = structuredClone(defaultConfig);
	config.routes.deepseek = {
		...config.routes.deepseek!, baseUrl: origin, model: 'fixture-model', keyEnv: 'CHECK_FIXTURE_KEY',
	};
	config.telegram.allowedGroups = ['-1001'];
	config.telegram.allowedUsers = ['1'];
	let setupServer: ReturnType<typeof createServer> | undefined;
	try {
		await store.open();
		await store.putSecrets({CHECK_FIXTURE_KEY: 'PRIVATE_API_KEY', TELEGRAM_BOT_TOKEN: 'PRIVATE_BOT_TOKEN'});
		const model = await checkModelConnection(config, store, 'deepseek');
		expect(model.modelAvailable).toBe(true);
		expect(model.models).toEqual(['fixture-model']);
		config.routes.deepseek.transport = 'anthropic';
		expect((await checkModelConnection(config, store, 'deepseek')).connected).toBe(true);
		config.routes.deepseek.transport = 'openai';
		const telegram = await checkTelegramConnection(config, store, fetch, origin);
		expect(telegram.botUsername).toBe('fixture_bot');
		expect(telegram.groups[0]?.title).toBe('Fixture PC group');
		expect(telegram.webhookConfigured).toBe(false);
		expect(telegram.canReadAllGroupMessages).toBe(false);
		expect(telegram.displayName).toBe('Long original name');
		expect(await setTelegramDisplayName(store, 'Pikachu', fetch, origin)).toEqual({saved: true, displayName: 'Pikachu'});
		expect(paths.some((path) => /getUpdates|sendMessage|chat\/completions/.test(path))).toBe(false);
		const setup = setupApp({
			home, config, store, busy: () => false, telegramStatus: () => 'fixture', async changed() {/* No external gateway. */},
		}, 'fixture-auth');
		setupServer = createServer(setup.app);
		await new Promise<void>((done) => {
			setupServer!.listen(0, '127.0.0.1', done);
		});
		const setupAddress = setupServer.address();
		if (!setupAddress || typeof setupAddress === 'string') {
			throw new Error('No setup fixture port.');
		}

		const base = `http://127.0.0.1:${setupAddress.port}`;
		expect((await fetch(`${base}/api/check-model`, {method: 'POST'})).status).toBe(401);
		const result = await fetch(`${base}/api/check-model`, {method: 'POST', headers: {Authorization: 'Bearer fixture-auth', 'Content-Type': 'application/json'}, body: JSON.stringify({route: 'deepseek'})});
		expect(result.status).toBe(200);
		const text = await result.text();
		expect(text).not.toContain('PRIVATE_API_KEY');
		expect(text).not.toContain('PRIVATE_DO_NOT_RETURN');
		config.routes.deepseek.baseUrl = `${origin}/failed`;
		const failure = await fetch(`${base}/api/check-model`, {method: 'POST', headers: {Authorization: 'Bearer fixture-auth', 'Content-Type': 'application/json'}, body: JSON.stringify({route: 'deepseek'})});
		expect(failure.status).toBe(400);
		expect(await failure.text()).not.toContain('PRIVATE_REMOTE_ERROR');
	} finally {
		await store.close();
		if (setupServer) {
			setupServer.closeAllConnections();
			await new Promise<void>((done) => {
				setupServer!.close(() => {
					done();
				});
			});
		}

		provider.closeAllConnections();
		await new Promise<void>((done) => {
			provider.close(() => {
				done();
			});
		});
		await rm(home, {recursive: true, force: true});
	}
});
