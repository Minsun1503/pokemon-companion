import {it, expect} from 'vitest';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {join, resolve, relative} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {LocalJournal} from '../learning/privacy.js';
import {HarnessStore} from './store.js';
import {HarnessEngine} from './engine.js';
import {GatewayApprovals} from './approvals.js';
import {defaultConfig} from './config.js';
import {setupApp} from './setup-server.js';
import {TelegramGateway} from './telegram.js';

async function fixture(run: (store: HarnessStore, home: string) => Promise<void>) {
	const home = await mkdtemp(join(tmpdir(), 'pokemon-gateway-test-'));
	const path = relative(resolve(tmpdir()), resolve(home));
	if (path.startsWith('..') || !path.startsWith('pokemon-gateway-test-')) {
		throw new Error('Unexpected fixture path.');
	}

	const store = new HarnessStore(new LocalJournal(join(home, 'store'), Buffer.alloc(32, 9)));
	try {
		await store.open();
		await run(store, home);
	} finally {
		await store.close();
		await rm(home, {recursive: true, force: true});
	}
}

it('reports deferred provider setup without calling a model', async () => fixture(async (store) => {
	let modelCalls = 0;
	const config = structuredClone(defaultConfig);
	config.routes.deepseek!.keyEnv = 'POKEMON_STATUS_TEST_KEY';
	const engine = new HarnessEngine(config, store, new GatewayApprovals(), {
		list: async () => [], call: async () => ({content: []}),
	}, async () => {
		modelCalls += 1;
		return {content: 'unused', calls: []};
	});
	const replies: string[] = [];
	await engine.receive('owner', '/status', async (reply) => {
		replies.push(reply);
	});
	expect(replies.join('\n')).toContain('waiting for a provider key and model');
	expect(modelCalls).toBe(0);
}));

it('persists Telegram admission before dispatch and rejects duplicate and older updates after restart', async () => fixture(async (store, home) => {
	expect(await store.admitTelegram('77', 9000)).toBe(true);
	expect(await store.admitTelegram('77', 9000)).toBe(false);
	expect(await store.admitTelegram('77', 8999)).toBe(false);
	await store.close();
	const reopened = new HarnessStore(new LocalJournal(join(home, 'store'), Buffer.alloc(32, 9)));
	try {
		await reopened.open();
		expect(reopened.telegramOffset('77')).toBe(9000);
		expect(await reopened.admitTelegram('77', 9000)).toBe(false);
		expect(await reopened.admitTelegram('77', 9001)).toBe(true);
		expect(await reopened.admitTelegram('other-bot', 1)).toBe(true);
	} finally {
		await reopened.close();
	}
}));

it('allows /stop while a native action waits for approval and never exposes approval codes to the model', async () => fixture(async (store) => {
	let dispatches = 0;
	const histories: string[] = [];
	const engine = new HarnessEngine(structuredClone(defaultConfig), store, new GatewayApprovals(), {
		list: async () => [{name: 'windows', inputSchema: {type: 'object'}}],
		async call() {
			dispatches += 1;
			return {content: []};
		},
	}, async (_route, _key, messages) => {
		histories.push(JSON.stringify(messages));
		return {content: '', calls: [{id: 'write', name: 'windows', args: {action: 'set_value', text: 'fixture draft'}}]};
	});
	const output: string[] = [];
	let code = '';
	await engine.receive('owner', 'Fill the fixture', async (text) => {
		output.push(text);
		const match = /\/allow ([a-f0-9]+)/.exec(text);
		if (match) {
			code = match[1];
			await engine.receive('owner', '/stop', async (reply) => {
				output.push(reply);
			});
		}
	});
	expect(code).not.toBe('');
	expect(histories.join('')).not.toContain(code);
	expect(dispatches).toBe(0);
	expect(engine.busy).toBe(false);
	expect(output.at(-1)).toContain('stopped');
}));

it('blocks learning replay and native URL launch before dispatch', async () => fixture(async (store) => {
	let dispatches = 0;
	const calls = [{id: 'replay', name: 'learning', args: {action: 'run'}}, {id: 'url', name: 'windows', args: {steps: [{action: 'launch', text: 'https://example.com'}]}}];
	const engine = new HarnessEngine(structuredClone(defaultConfig), store, new GatewayApprovals(), {
		list: async () => calls.map((call) => ({name: call.name, inputSchema: {type: 'object'}})),
		async call() {
			dispatches += 1;
			return {content: []};
		},
	}, async () => ({content: '', calls: [calls.shift()!]}));
	const output: string[] = [];
	await engine.receive('owner', 'one', async (text) => {
		output.push(text);
	});
	await engine.receive('owner', 'two', async (text) => {
		output.push(text);
	});
	expect(dispatches).toBe(0);
	expect(output[0]).toContain('replay');
	expect(output[1]).toContain('browser DOM');
}));

it('serializes desktop tasks across owners and cancels a queued owner without running its model', async () => fixture(async (store) => {
	let release!: () => void;
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	const requests: string[] = [];
	const engine = new HarnessEngine(structuredClone(defaultConfig), store, new GatewayApprovals(), {
		list: async () => [], call: async () => ({content: []}),
	}, async (_route, _key, messages) => {
		requests.push(messages.at(-1)!.content);
		await wait;
		return {content: 'completed fixture', calls: []};
	});
	const first = engine.receive('first', 'first task', async () => {/* Discard fixture replies. */});
	const second = engine.receive('second', 'second task', async () => {/* Discard fixture replies. */});
	engine.stop('second');
	release();
	await Promise.all([first, second]);
	expect(requests).toEqual(['first task']);
	expect(engine.busy).toBe(false);
}));

it('admits commands only from a listed sender in the designated group and ignores conversation and other bots', async () => fixture(async (store) => {
	const tasks: string[] = [];
	const engine = new HarnessEngine(structuredClone(defaultConfig), store, new GatewayApprovals(), {list: async () => [], call: async () => ({content: []})}, async (_route, _key, messages) => {
		tasks.push(messages.at(-1)!.content);
		return {content: 'fixture result', calls: []};
	});
	const gateway = new TelegramGateway(engine, 'fixture', new Set(['1']), undefined, new Set(['-1001']));
	gateway.send = async () => {/* No external fixture messages. */};
	const group = {text: '/task@fixture_bot inspect the desktop', from: {id: 1}, chat: {id: -1001, type: 'supergroup'}};
	await gateway.handle({update_id: 1, message: {...group, from: {id: 2}}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 2, message: {...group, chat: {id: -1002, type: 'supergroup'}}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 3, message: {...group, text: 'ordinary group conversation'}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 4, message: {...group, text: '/task@other_bot inspect the desktop'}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 5, message: {...group, sender_chat: {id: -1001}}}, '77', 'fixture_bot');
	expect(tasks).toEqual([]);
	await gateway.handle({update_id: 6, message: group}, '77', 'fixture_bot');
	await gateway.handle({update_id: 6, message: group}, '77', 'fixture_bot');
	expect(tasks).toEqual(['inspect the desktop']);
}));

it('routes exact mentions and replies while preserving group admission and private approval boundaries', async () => fixture(async (store) => {
	const tasks: string[] = [];
	const engine = new HarnessEngine(structuredClone(defaultConfig), store, new GatewayApprovals(), {list: async () => [], call: async () => ({content: []})}, async (_route, _key, messages) => {
		tasks.push(messages.at(-1)!.content);
		return {content: 'fixture result', calls: []};
	});
	const gateway = new TelegramGateway(engine, 'fixture', new Set(['1']), undefined, new Set(['-1001']));
	gateway.send = async () => {/* No external fixture messages. */};
	const group = {text: '@fixture_bot inspect the desktop', from: {id: 1}, chat: {id: -1001, type: 'supergroup'}};
	await gateway.handle({update_id: 1, message: {...group, from: {id: 2}}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 2, message: {...group, chat: {id: -1002, type: 'supergroup'}}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 3, message: {...group, text: 'inspect @fixture_bot_extra'}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 4, message: {...group, text: 'email@fixture_bot'}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 5, message: {...group, text: '@fixture_bot /allow secret'}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 6, message: {...group, text: '@fixture_bot /task@other_bot inspect'}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 7, message: {...group, text: 'inspect', reply_to_message: {from: {id: 88, is_bot: true}}}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 8, message: {...group, sender_chat: {id: -1001}}}, '77', 'fixture_bot');
	expect(tasks).toEqual([]);
	await gateway.handle({update_id: 9, message: {...group, text: 'inspect the desktop @FIXTURE_BOT'}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 10, message: {...group, text: 'read the window', reply_to_message: {from: {id: 77, is_bot: true}}}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 11, message: {...group, text: '@fixture_bot /task inspect once'}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 11, message: {...group, text: '@fixture_bot /task inspect once'}}, '77', 'fixture_bot');
	expect(tasks).toEqual(['inspect the desktop', 'read the window', 'inspect once']);
}));

it('answers an addressed greeting without a provider key and explains what remains to configure', async () => fixture(async (store) => {
	let modelCalls = 0;
	const config = structuredClone(defaultConfig);
	config.routes.deepseek!.keyEnv = 'POKEMON_GREETING_TEST_KEY';
	const engine = new HarnessEngine(config, store, new GatewayApprovals(), {list: async () => [], call: async () => ({content: []})}, async () => {
		modelCalls += 1;
		return {content: 'unused', calls: []};
	});
	const gateway = new TelegramGateway(engine, 'fixture', new Set(['1']), undefined, new Set(['-1001']));
	const output: string[] = [];
	gateway.send = async (chat, text) => {
		expect(chat).toBe(-1001);
		output.push(text);
	};

	await gateway.handle({update_id: 1, message: {text: 'Hi @fixture_bot', from: {id: 1}, chat: {id: -1001, type: 'supergroup'}}}, '77', 'fixture_bot');
	expect(output.join('\n')).toContain('Hi! I’m connected');
	expect(output.join('\n')).toContain('waiting for a provider key and model');
	expect(modelCalls).toBe(0);
}));

it('delivers group-task approval codes privately and accepts the owning user private decision once', async () => fixture(async (store) => {
	const output: {chat: number; text: string}[] = [];
	const histories: string[] = [];
	let dispatches = 0;
	const engine = new HarnessEngine(structuredClone(defaultConfig), store, new GatewayApprovals(), {
		list: async () => [{name: 'windows', inputSchema: {type: 'object'}}],
		async call() {
			dispatches += 1;
			return {content: []};
		},
	}, async (_route, _key, messages) => {
		histories.push(JSON.stringify(messages));
		return messages.at(-1)?.role === 'tool' ? {content: 'verified group result', calls: []} : {content: '', calls: [{id: 'write', name: 'windows', args: {action: 'set_value', text: 'fixture draft'}}]};
	});
	const gateway = new TelegramGateway(engine, 'fixture', new Set(['1']), undefined, new Set(['-1001']));
	let approvalCode = '';
	gateway.send = async (chat, text) => {
		output.push({chat, text});
		const code = /\/allow ([a-f0-9]+)/.exec(text)?.[1];
		if (!code) {
			return;
		}

		approvalCode = code;
		expect(chat).toBe(1);
		expect(dispatches).toBe(0);
		await gateway.handle({update_id: 2, message: {text: `/allow ${code}`, from: {id: 2}, chat: {id: 2, type: 'private'}}}, '77', 'fixture_bot');
		expect(dispatches).toBe(0);
		await gateway.handle({update_id: 3, message: {text: `/allow ${code}`, from: {id: 1}, chat: {id: 1, type: 'private'}}}, '77', 'fixture_bot');
	};

	await gateway.handle({update_id: 1, message: {text: '/task@fixture_bot fill the fixture', from: {id: 1}, chat: {id: -1001, type: 'supergroup'}}}, '77', 'fixture_bot');
	expect(dispatches).toBe(1);
	expect(approvalCode).not.toBe('');
	expect(output.filter((item) => item.chat === -1001).map((item) => item.text)).toEqual(['verified group result']);
	expect(histories.join('')).not.toContain(approvalCode);
}));

it('authenticates setup, encrypts saved keys, returns no secrets, and refuses changes while work is active', async () => fixture(async (store, home) => {
	const config = structuredClone(defaultConfig);
	let busy = false;
	let changes = 0;
	const {app, token} = setupApp({
		home, config, store, busy: () => busy, telegramStatus: () => 'fixture', async changed() {
			changes += 1;
		},
	});
	const server = createServer(app);
	await new Promise<void>((resolve) => {
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Missing fixture port.');
	}

	const base = `http://127.0.0.1:${address.port}`;
	const headers = {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'};
	try {
		expect((await fetch(`${base}/api/status`)).status).toBe(401);
		const next = structuredClone(config);
		next.routes.custom = {...next.routes.deepseek, model: 'fixture', keyEnv: 'FIXTURE_KEY'};
		next.defaultRoute = 'custom';
		const response = await fetch(`${base}/api/config`, {method: 'POST', headers, body: JSON.stringify({config: next, secrets: {FIXTURE_KEY: 'PRIVATE_FIXTURE_KEY'}})});
		expect(response.status).toBe(200);
		expect(changes).toBe(1);
		expect(config.defaultRoute).toBe('custom');
		const status = await (await fetch(`${base}/api/status`, {headers})).text();
		expect(status).toContain('FIXTURE_KEY');
		expect(status).not.toContain('PRIVATE_FIXTURE_KEY');
		expect(await readFile(join(home, 'config.json'), 'utf8')).not.toContain('PRIVATE_FIXTURE_KEY');
		expect(await readFile(join(home, 'store/events.enc'), 'utf8')).not.toContain('PRIVATE_FIXTURE_KEY');
		busy = true;
		expect((await fetch(`${base}/api/config`, {method: 'POST', headers, body: JSON.stringify({config})})).status).toBe(400);
		expect(changes).toBe(1);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => {
			server.close(() => {
				resolve();
			});
		});
	}
}));
