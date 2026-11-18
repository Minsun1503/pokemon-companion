import {it, expect, vi} from 'vitest';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {join, resolve, relative} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {LocalJournal} from '../learning/privacy.js';
import {HarnessStore} from './store.js';
import {HarnessEngine} from './engine.js';
import {GatewayApprovals} from './approvals.js';
import {
	defaultConfig, deepSeekConfig, loadConfig, validateDeepSeekConfig,
} from './config.js';
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

it('enforces one DeepSeek credential and rejects provider/fallback/relay changes before saving', async () => fixture(async (store, home) => {
	const config = await loadConfig(home, true);
	expect(config).toEqual(deepSeekConfig());
	expect(Object.keys(config.routes)).toEqual(['deepseek']);
	for (const changed of [
		{...config, routes: {...config.routes, claude: defaultConfig.routes.claude!}},
		{...config, fallbacks: ['deepseek']},
		{...config, desktopRelay: {enabled: true, conversation: 'other', approval: 'per_message' as const}},
		{...config, routes: {deepseek: {...config.routes.deepseek!, baseUrl: 'https://example.com'}}},
	]) {
		expect(() => {
			validateDeepSeekConfig(changed);
		}).toThrow('one DeepSeek');
	}

	const {app, token} = setupApp({
		home, config, store, deepSeekOnly: true, busy: () => false, telegramStatus: () => 'off', async changed() {/* Fixture only. */},
	});
	const server = app.listen(0, '127.0.0.1');
	await new Promise<void>((resolve) => {
		server.once('listening', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw Error('Missing fixture port');
	}

	try {
		const endpoint = `http://127.0.0.1:${address.port}/api`;
		const headers = {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'};
		const rejected = await fetch(`${endpoint}/config`, {method: 'POST', headers, body: JSON.stringify({config, secrets: {OPENAI_API_KEY: 'fixture-not-real'}})});
		expect(rejected.status).toBe(400);
		expect(store.secret('OPENAI_API_KEY')).toBe('');
		const allowed = await fetch(`${endpoint}/config`, {method: 'POST', headers, body: JSON.stringify({config, secrets: {DEEPSEEK_API_KEY: 'fixture-not-real'}})});
		expect(allowed.ok).toBe(true);
		expect(store.secret('DEEPSEEK_API_KEY')).toBe('fixture-not-real');
		const status = await (await fetch(`${endpoint}/status`, {headers})).json() as {deepSeekOnly: boolean};
		expect(status.deepSeekOnly).toBe(true);
	} finally {
		await new Promise<void>((resolve) => {
			server.close(() => {
				resolve();
			});
		});
	}
}));

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

it('privately discovers group IDs for an allowlisted owner without authorizing the group or running a model', async () => fixture(async (store) => {
	let modelCalls = 0;
	const engine = new HarnessEngine(structuredClone(defaultConfig), store, new GatewayApprovals(), {
		list: async () => [], call: async () => ({content: []}),
	}, async () => {
		modelCalls += 1;
		return {content: 'unused', calls: []};
	});
	const gateway = new TelegramGateway(engine, 'fixture', new Set(['1']), undefined, new Set(['-1001']));
	const sent: {chat: number; text: string}[] = [];
	gateway.send = async (chat, text) => {
		sent.push({chat, text});
	};

	const message = {text: '/whereami@fixture_bot', from: {id: 1}, chat: {id: -1009, type: 'supergroup'}};
	await gateway.handle({update_id: 1, message: {...message, from: {id: 2}}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 2, message: {...message, text: '/whereami@other_bot'}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 3, message}, '77', 'fixture_bot');
	await gateway.handle({update_id: 3, message}, '77', 'fixture_bot');
	await gateway.handle({update_id: 4, message: {...message, text: '/task@fixture_bot Control this computer'}}, '77', 'fixture_bot');
	expect(sent).toHaveLength(1);
	expect(sent[0]?.chat).toBe(1);
	expect(sent[0]?.text).toContain('Group ID: -1009');
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

it('uses groups only for registration and accepts plain private messages in an isolated session', async () => fixture(async (store) => {
	const requests: string[] = [];
	const engine = new HarnessEngine(structuredClone(defaultConfig), store, new GatewayApprovals(), {list: async () => [], call: async () => ({content: []})}, async (_r, _k, messages) => {
		requests.push(messages.at(-1)!.content);
		return {content: 'Private result', calls: []};
	});
	const gateway = new TelegramGateway(engine, 'fixture', new Set(['1']), undefined, new Set(['-1001']));
	const sent: {chat: number; text: string}[] = [];
	gateway.send = async (chat, text) => {
		sent.push({chat, text});
	};

	gateway.api = async () => true;
	const group = {from: {id: 1}, chat: {id: -1001, type: 'group'}, text: '@fixture_bot register'};
	await gateway.handle({update_id: 1, message: {...group, chat: {id: 1, type: 'private'}, text: 'Do work before registration'}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 2, message: {...group, text: 'ordinary conversation'}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 3, message: {...group, from: {id: 2}}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 4, message: {...group, chat: {id: -1002, type: 'group'}}}, '77', 'fixture_bot');
	expect(store.registration('77', '1')).toBeUndefined();
	await gateway.handle({update_id: 5, message: group}, '77', 'fixture_bot');
	const {session} = (store.registration('77', '1')!);
	await gateway.handle({update_id: 6, message: {...group, text: '@fixture_bot execute dangerous work in group'}}, '77', 'fixture_bot');
	expect(store.registration('77', '1')!.session).toBe(session);
	expect(requests).toEqual([]);
	await gateway.handle({update_id: 7, message: {...group, chat: {id: 1, type: 'private'}, text: 'Read the desktop'}}, '77', 'fixture_bot');
	await gateway.handle({update_id: 7, message: {...group, chat: {id: 1, type: 'private'}, text: 'Read the desktop'}}, '77', 'fixture_bot');
	expect(requests).toEqual(['Read the desktop']);
	expect(sent.filter((item) => item.text === 'Private result').map((item) => item.chat)).toEqual([1]);
	expect(sent.map((item) => item.text).join(' ')).not.toContain('accepted');
	expect(sent.map((item) => item.text).join(' ')).not.toContain('Task ');
	expect(store.tasks('telegram:77:1:-1001')).toHaveLength(0);
}));

it('keeps registration across restart, handles a blocked DM with a start link, and revokes removed groups', async () => fixture(async (store, home) => {
	const engine = new HarnessEngine(structuredClone(defaultConfig), store, new GatewayApprovals(), {list: async () => [], call: async () => ({content: []})});
	const gateway = new TelegramGateway(engine, 'fixture', new Set(['1']), undefined, new Set(['-1001']));
	const sent: string[] = [];
	gateway.send = async (chat, text) => {
		if (chat === 1) {
			throw Error('DM blocked');
		}

		sent.push(text);
	};

	const message = {text: '@fixture_bot register', from: {id: 1}, chat: {id: -1001, type: 'group'}};
	await gateway.handle({update_id: 1, message}, '77', 'fixture_bot');
	expect(sent.join(' ')).toContain('https://t.me/fixture_bot?start=session');
	expect(sent.join(' ')).toContain('Bắt đầu');
	const registration = store.registration('77', '1');
	await store.close();
	const reopened = new HarnessStore(new LocalJournal(join(home, 'store'), Buffer.alloc(32, 9)));
	try {
		await reopened.open();
		expect(reopened.registration('77', '1')).toEqual(registration);
		const fresh = new TelegramGateway(new HarnessEngine(structuredClone(defaultConfig), reopened, new GatewayApprovals(), {list: async () => [], call: async () => ({content: []})}), 'fixture', new Set(['1']));
		const output: string[] = [];
		fresh.send = async (_chat, text) => {
			output.push(text);
		};

		await fresh.handle({update_id: 2, message: {...message, chat: {id: 1, type: 'private'}, text: 'Do work'}}, '77', 'fixture_bot');
		expect(output.join(' ')).toContain('nhóm đăng ký');
	} finally {
		await reopened.close();
	}
}));

it('approves in the private session with owner/chat/message-bound buttons and no approval data in the model', async () => fixture(async (store) => {
	const output: {chat: number; text: string}[] = [];
	const histories: string[] = [];
	let dispatches = 0;
	const engine = new HarnessEngine(structuredClone(defaultConfig), store, new GatewayApprovals(5000), {
		list: async () => [{name: 'windows', inputSchema: {type: 'object'}}],
		async call() {
			dispatches += 1;
			return {content: []};
		},
	}, async (_r, _k, messages) => {
		histories.push(JSON.stringify(messages));
		return messages.at(-1)?.role === 'tool' ? {content: 'verified group result', calls: []} : {content: '', calls: [{id: 'write', name: 'windows', args: {action: 'set_value', text: 'fixture draft'}}]};
	});
	await store.register('77', '1', '-1001');
	const gateway = new TelegramGateway(engine, 'fixture', new Set(['1', '2']), undefined, new Set(['-1001', '-1002']));
	let data = '';
	let cleaned = false;
	gateway.send = async (chat, text) => {
		output.push({chat, text});
	};

	gateway.api = async (method, args) => {
		if (method === 'sendMessage') {
			expect(args.chat_id).toBe(1);
			expect(args.text).toContain('fixture draft');
			expect(args.text).not.toContain('/allow');
			data = (args.reply_markup as {inline_keyboard: {callback_data: string}[][]}).inline_keyboard[0]![0]!.callback_data;
			return {message_id: 91};
		}

		if (method === 'editMessageReplyMarkup') {
			cleaned = true;
		}

		return true;
	};

	const work = gateway.handle({update_id: 1, message: {text: 'fill the fixture', from: {id: 1}, chat: {id: 1, type: 'private'}}}, '77', 'fixture_bot');
	await vi.waitFor(() => {
		expect(data).not.toBe('');
	});
	const click = async (update_id: number, owner: number, chat = 1, message_id = 91, sender = 77) => gateway.handle({
		update_id, callback_query: {
			id: `click-${update_id}`, data, from: {id: owner}, message: {message_id, from: {id: sender, is_bot: true}, chat: {id: chat, type: chat > 0 ? 'private' : 'group'}},
		},
	}, '77', 'fixture_bot');
	await click(2, 2);
	await click(3, 1, -1002);
	await click(4, 1, 1, 92);
	await click(5, 1, 1, 91, 88);
	const code = data.slice(5);
	await gateway.handle({update_id: 6, message: {text: `/allow ${code}`, from: {id: 1}, chat: {id: 1, type: 'private'}}}, '77', 'fixture_bot');
	expect(dispatches).toBe(0);
	await click(7, 1);
	await work;
	await click(8, 1);
	expect(dispatches).toBe(1);
	expect(cleaned).toBe(true);
	expect(output.filter((item) => item.chat === 1).map((item) => item.text)).toEqual(['Bạn dùng nút Cho phép hoặc Từ chối trên yêu cầu duyệt nhé.', 'verified group result']);
	expect(histories.join('')).not.toContain(code);
}));

it('expires private approval buttons and never dispatches after timeout', async () => fixture(async (store) => {
	let dispatches = 0;
	const engine = new HarnessEngine(structuredClone(defaultConfig), store, new GatewayApprovals(20), {
		list: async () => [{name: 'windows', inputSchema: {type: 'object'}}], async call() {
			dispatches += 1;
			return {content: []};
		},
	}, async () => ({content: '', calls: [{id: 'write', name: 'windows', args: {action: 'set_value'}}]}));
	await store.register('77', '1', '-1001');
	const gateway = new TelegramGateway(engine, 'fixture', new Set(['1']), undefined, new Set(['-1001']));
	let data = '';
	let removed = false;
	gateway.send = async () => {/* Discard fixture result. */};
	gateway.api = async (method, args) => {
		if (method === 'sendMessage') {
			data = (args.reply_markup as {inline_keyboard: {callback_data: string}[][]}).inline_keyboard[0]![0]!.callback_data;
			return {message_id: 51};
		}

		if (method === 'editMessageReplyMarkup') {
			removed = true;
		}

		return true;
	};

	await gateway.handle({update_id: 1, message: {text: 'write', from: {id: 1}, chat: {id: 1, type: 'private'}}}, '77', 'fixture_bot');
	await gateway.handle({
		update_id: 2, callback_query: {
			id: 'late', data, from: {id: 1}, message: {message_id: 51, from: {id: 77, is_bot: true}, chat: {id: 1, type: 'private'}},
		},
	}, '77', 'fixture_bot');
	expect(removed).toBe(true);
	expect(dispatches).toBe(0);
}));

it.each(['deny', 'stop'])('removes private buttons after %s and rejects a later allow', async (decision) => fixture(async (store) => {
	let dispatches = 0;
	const engine = new HarnessEngine(structuredClone(defaultConfig), store, new GatewayApprovals(5000), {
		list: async () => [{name: 'windows', inputSchema: {type: 'object'}}],
		async call() {
			dispatches += 1;
			return {content: []};
		},
	}, async () => ({content: '', calls: [{id: 'w', name: 'windows', args: {action: 'set_value', text: 'fixture'}}]}));
	await store.register('77', '1', '-1001');
	const gateway = new TelegramGateway(engine, 'fixture', new Set(['1']), undefined, new Set(['-1001']));
	let data = '';
	let removed = false;
	gateway.send = async () => {/* No external fixture messages. */};
	gateway.api = async (method, args) => {
		if (method === 'sendMessage') {
			data = (args.reply_markup as {inline_keyboard: {callback_data: string}[][]}).inline_keyboard[0]![0]!.callback_data;
			return {message_id: 55};
		}

		if (method === 'editMessageReplyMarkup') {
			removed = true;
		}

		return true;
	};

	const group = {id: 1, type: 'private'};
	const work = gateway.handle({update_id: 1, message: {text: 'write', from: {id: 1}, chat: group}}, '77', 'fixture_bot');
	await vi.waitFor(() => {
		expect(data).not.toBe('');
	});
	const callback = {
		id: 'decision', data: data.replace('pk:a:', 'pk:d:'), from: {id: 1}, message: {message_id: 55, from: {id: 77, is_bot: true}, chat: group},
	};
	if (decision === 'deny') {
		await gateway.handle({update_id: 2, callback_query: callback}, '77', 'fixture_bot');
	} else {
		await gateway.handle({update_id: 2, message: {text: '/stop@fixture_bot', from: {id: 1}, chat: group}}, '77', 'fixture_bot');
	}

	await work;
	await gateway.handle({update_id: 3, callback_query: {...callback, data}}, '77', 'fixture_bot');
	expect(dispatches).toBe(0);
	expect(removed).toBe(true);
	expect(engine.busy).toBe(false);
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
