import {describe, it, expect} from 'vitest';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname, basename} from 'node:path';
import {createServer} from 'node:http';
import type {Tool} from '@modelcontextprotocol/sdk/types.js';
import {LocalJournal} from '../learning/privacy.js';
import {approvalIntent} from '../security/approval.js';
import {HarnessStore} from './store.js';
import {GatewayApprovals} from './approvals.js';
import {HarnessEngine, needsNativeApproval} from './engine.js';
import {defaultConfig, configSchema, type Route} from './config.js';
import {callModel, type ModelClient} from './models.js';
import {TelegramGateway} from './telegram.js';

const definition: Tool = {name: 'windows', inputSchema: {type: 'object'}};
async function fixture(run: (store: HarnessStore, dir: string) => Promise<void>) {
	const dir = await mkdtemp(join(tmpdir(), 'pokemon-harness-'));
	const store = new HarnessStore(new LocalJournal(dir, Buffer.alloc(32, 7)));
	try {
		await store.open();
		await run(store, dir);
	} finally {
		await store.close();
		expect(dirname(dir)).toBe(tmpdir());
		expect(basename(dir)).toMatch(/^pokemon-harness-/);
		await rm(dir, {recursive: true, force: true});
	}
}

function config() {
	const value = structuredClone(defaultConfig);
	value.routes.deepseek.model = 'synthetic';
	return value;
}

describe('Pokémon harness trust, routing and durable admission', () => {
	it('encrypts secrets and sessions and retains admitted update IDs across restart', async () => fixture(async (store, dir) => {
		await store.putSecrets({TEST_KEY: 'PRIVATE_CREDENTIAL'});
		store.session('owner', 'deepseek').messages.push({role: 'user', content: 'PRIVATE_CHAT'});
		expect(await store.admit('bot:update-1')).toBe(true);
		const disk = await readFile(join(dir, 'events.enc'), 'utf8');
		expect(disk).not.toContain('PRIVATE_CREDENTIAL');
		expect(disk).not.toContain('PRIVATE_CHAT');
		await store.close();
		const reopened = new HarnessStore(new LocalJournal(dir, Buffer.alloc(32, 7)));
		try {
			await reopened.open();
			expect(reopened.secret('TEST_KEY')).toBe('PRIVATE_CREDENTIAL');
			expect(await reopened.admit('bot:update-1')).toBe(false);
			expect(reopened.session('owner', 'deepseek').messages[0].content).toBe('PRIVATE_CHAT');
		} finally {
			await reopened.close();
		}
	}));
	it('shows a complete native action, accepts only the owning chat, consumes once and dispatches once', async () => fixture(async (store) => {
		const approvals = new GatewayApprovals(2000);
		let dispatched = 0;
		const received: string[] = [];
		const model: ModelClient = async (_route, _key, messages) => messages.at(-1)?.role === 'tool' ? {content: 'verified fixture result', calls: []} : {content: '', calls: [{id: 'one', name: 'windows', args: {action: 'set_value', text: 'full draft', window_id: '1'}}]};
		const engine = new HarnessEngine(config(), store, approvals, {
			list: async () => [definition], async call() {
				dispatched += 1;
				return {content: [{type: 'text', text: 'verified'}]};
			},
		}, model);
		let decided = false;
		await engine.receive('owner', 'Fill the fixture', async (text) => {
			received.push(text);
			const code = (/\/allow ([a-f0-9]+)/.exec(text))?.[1];
			if (code) {
				expect(text).toContain('full draft');
				expect(approvals.decide('attacker', code, true)).toBe(false);
				expect(dispatched).toBe(0);
				expect(approvals.decide('owner', code, true)).toBe(true);
				expect(approvals.decide('owner', code, true)).toBe(false);
				decided = true;
			}
		});
		expect(decided).toBe(true);
		expect(dispatched).toBe(1);
		expect(received.at(-1)).toBe('verified fixture result');
	}));
	it('expires approvals and never dispatches after /stop', async () => {
		const approvals = new GatewayApprovals(5);
		const intent = approvalIntent('native', 'click', 'fixture', 'https://fixture.test/', '', {}, {});
		expect((await approvals.context.run({principal: 'one', async send() {/* Discard fixture message. */}, signal: new AbortController().signal}, async () => approvals.ask(intent))).authorized).toBe(false);
		const abort = new AbortController();
		expect((await approvals.context.run({
			principal: 'one', async send() {
				abort.abort();
			}, signal: abort.signal,
		}, async () => approvals.ask(intent))).authorized).toBe(false);
	});
	it('never retries an uncertain tool delivery and keeps other sessions separate', async () => fixture(async (store) => {
		let dispatches = 0;
		const engine = new HarnessEngine(config(), store, new GatewayApprovals(), {
			list: async () => [definition], async call() {
				dispatches += 1;
				return {content: [{type: 'text', text: 'ACTION_OUTCOME_UNKNOWN delivery_uncertain'}]};
			},
		}, async () => ({content: '', calls: [{id: 'one', name: 'windows', args: {action: 'get_ui'}}]}));
		const received: string[] = [];
		await engine.receive('owner', 'read', async (text) => {
			received.push(text);
		});
		expect(dispatches).toBe(1);
		expect(received.at(-1)).toContain('uncertain');
		expect(store.session('other', 'claude').messages).toEqual([]);
	}));
	it('falls back model requests with the same tool results without replaying tools', async () => fixture(async (store) => {
		const settings = config();
		settings.fallbacks = ['claude'];
		settings.routes.claude.model = 'backup';
		let dispatches = 0;
		const requests: string[] = [];
		const model: ModelClient = async (route, _key, messages) => {
			requests.push(route.label);
			if (route.label === 'DeepSeek API') {
				throw new Error('provider unavailable');
			}

			return messages.at(-1)?.role === 'tool' ? {content: 'backup verified', calls: []} : {content: '', calls: [{id: 'one', name: 'windows', args: {action: 'get_ui'}}]};
		};

		const engine = new HarnessEngine(settings, store, new GatewayApprovals(), {
			list: async () => [definition], async call() {
				dispatches += 1;
				return {content: [{type: 'text', text: 'observed fixture'}]};
			},
		}, model);
		const received: string[] = [];
		await engine.receive('owner', 'read', async (text) => {
			received.push(text);
		});
		expect(dispatches).toBe(1);
		expect(requests).toEqual(['DeepSeek API', 'Claude API', 'DeepSeek API', 'Claude API']);
		expect(received.at(-1)).toBe('backup verified');
	}));
	it('rejects unlisted users, groups and bots before any model/tool work and deduplicates admitted updates', async () => fixture(async (store) => {
		let turns = 0;
		const engine = new HarnessEngine(config(), store, new GatewayApprovals(), {list: async () => [], call: async () => ({content: []})}, async () => {
			turns += 1;
			return {content: 'fixture reply', calls: []};
		});
		const telegram = new TelegramGateway(engine, 'fixture-token', new Set(['1']));
		telegram.send = async () => {/* Discard fixture replies. */};
		const update = {update_id: 1, message: {text: 'inspect the desktop', from: {id: 2}, chat: {id: 2, type: 'private'}}};
		await telegram.handle(update, 'bot');
		await telegram.handle({...update, message: {...update.message, from: {id: 1}, chat: {id: 1, type: 'group'}}}, 'bot');
		expect(turns).toBe(0);
		const admitted = {...update, message: {...update.message, from: {id: 1}, chat: {id: 1, type: 'private'}}};
		await telegram.handle(admitted, 'bot');
		await telegram.handle(admitted, 'bot');
		expect(turns).toBe(1);
	}));
	it('blocks unsafe URLs and recognizes mutations inside native batches', () => {
		expect(configSchema.safeParse({...config(), routes: {bad: {...defaultConfig.routes.deepseek, baseUrl: 'https://user:password@fixture.test'}}}).success).toBe(false);
		expect(needsNativeApproval('windows', {steps: [{action: 'get_ui'}, {action: 'set_value'}]})).toBe(true);
		expect(needsNativeApproval('windows', {steps: [{action: 'get_ui'}, {action: 'read_text'}]})).toBe(false);
	});
});

describe('provider wire adapters', () => {
	it('sends authenticated OpenAI and native Anthropic tool histories to an actual HTTP fixture', async () => {
		const bodies: Record<string, unknown>[] = [];
		const server = createServer((request, response) => {
			let body = '';
			request.on('data', (chunk) => {
				body += String(chunk);
			});
			request.on('end', () => {
				bodies.push(JSON.parse(body) as Record<string, unknown>);
				response.setHeader('Content-Type', 'application/json');
				if (request.url?.endsWith('/messages')) {
					expect(request.headers['x-api-key']).toBe('fixture-key');
					response.end(JSON.stringify({
						content: [{
							type: 'tool_use', id: 'a', name: 'windows', input: {action: 'get_ui'},
						}],
					}));
				} else {
					expect(request.headers.authorization).toBe('Bearer fixture-key');
					response.end(JSON.stringify({choices: [{message: {reasoning_content: 'fixture reasoning', tool_calls: [{id: 'o', function: {name: 'windows', arguments: '{"action":"get_ui"}'}}]}}]}));
				}
			});
		});
		await new Promise<void>((resolve) => {
			server.listen(0, '127.0.0.1', resolve);
		});
		const address = server.address();
		if (!address || typeof address === 'string') {
			throw new Error('No fixture address.');
		}

		const route: Route = {...defaultConfig.routes.deepseek, baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture-model'};
		try {
			const messages = [{role: 'user' as const, content: 'read'}, {role: 'assistant' as const, content: '', calls: [{id: 'old', name: 'windows', args: {action: 'get_ui'}}]}, {role: 'tool' as const, callId: 'old', content: 'fixture observation'}];
			expect((await callModel(route, 'fixture-key', messages, [definition], new AbortController().signal)).calls[0].id).toBe('o');
			expect((await callModel({...route, transport: 'anthropic'}, 'fixture-key', messages, [definition], new AbortController().signal)).calls[0].id).toBe('a');
			expect(JSON.stringify(bodies[0])).toContain('tool_call_id');
			expect(JSON.stringify(bodies[1])).toContain('tool_result');
			expect(bodies[1].system).toBeTruthy();
			const reply = await callModel(route, 'fixture-key', messages, [definition], new AbortController().signal);
			const history = [...messages, {role: 'assistant' as const, ...reply}];
			await callModel(route, 'fixture-key', history, [definition], new AbortController().signal);
			expect(JSON.stringify(bodies[3])).toContain('reasoning_content');
			await callModel({...route, model: 'different-model'}, 'fixture-key', history, [definition], new AbortController().signal);
			expect(JSON.stringify(bodies[4])).not.toContain('reasoning_content');
		} finally {
			server.closeAllConnections();
			await new Promise<void>((resolve) => {
				server.close(() => {
					resolve();
				});
			});
		}
	});
});
