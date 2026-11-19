import {it, expect} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import {join, resolve, relative} from 'node:path';
import {tmpdir} from 'node:os';
import {LocalJournal} from '../learning/privacy.js';
import {HarnessStore} from './store.js';
import {HarnessEngine} from './engine.js';
import {GatewayApprovals} from './approvals.js';
import {
	deepSeekConfig, loadConfig, validateDeepSeekConfig,
} from './config.js';
import {TelegramGateway} from './telegram.js';
import {
	approvePairing, listPairing, requestPairing, revokeUser, pairingTtlMs,
} from './pairing.js';
import {runSetup} from './setup.js';

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

function gatewayFor(store: HarnessStore, home: string, turns: string[]) {
	const config = deepSeekConfig();
	config.team!.auto = false; // Team routing has its own tests; keep these turns direct.
	const engine = new HarnessEngine(config, store, new GatewayApprovals(), {list: async () => [], call: async () => ({content: []})}, async (_route, _key, messages) => {
		turns.push(messages.at(-1)!.content);
		return {content: 'fixture reply', calls: []};
	});
	const sent: {chat: number; text: string}[] = [];
	const gateway = new TelegramGateway(engine, 'fixture-token', async () => {
		const current = await loadConfig(home, true);
		return {users: new Set(current.telegram.allowedUsers), groups: new Set(current.telegram.allowedGroups)};
	}, async (userId, name) => requestPairing(home, userId, name));
	gateway.api = async () => true;
	gateway.send = async (chat, text) => {
		sent.push({chat, text});
	};

	return {gateway, sent};
}

it('pairs an unknown private sender by code, then serves them without a restart', async () => fixture(async (store, home) => {
	await loadConfig(home, true);
	const turns: string[] = [];
	const {gateway, sent} = gatewayFor(store, home, turns);
	const message = {text: 'mở Notepad', from: {id: 42, first_name: 'Nhat'}, chat: {id: 42, type: 'private'}};
	await gateway.handle({update_id: 1, message}, 'bot', 'fixture_bot');
	expect(turns).toEqual([]);
	const code = /Mã ghép cặp: ([A-Z2-9]{8})/.exec(sent.at(-1)!.text)?.[1];
	expect(code).toBeDefined();
	expect(sent.at(-1)!.text).toContain(`pairing approve ${code}`);

	// Repeated messages reuse the same live code.
	await gateway.handle({update_id: 2, message}, 'bot', 'fixture_bot');
	expect(sent.at(-1)!.text).toContain(code);
	expect(await listPairing(home)).toHaveLength(1);

	await expect(approvePairing(home, 'WRONGCOD')).rejects.toThrow(/hết hạn/);
	const approved = await approvePairing(home, code!.toLowerCase());
	expect(approved.userId).toBe('42');
	expect((await loadConfig(home, true)).telegram).toMatchObject({enabled: true, allowedUsers: ['42']});
	expect(await listPairing(home)).toEqual([]);

	await gateway.handle({update_id: 3, message}, 'bot', 'fixture_bot');
	expect(turns).toHaveLength(1);
	expect(turns[0]).toMatch(/^mở Notepad\n\n---\nPlaybooks/);
	expect(sent.at(-1)!.text).toBe('fixture reply');

	expect(await revokeUser(home, '42')).toBe(true);
	await gateway.handle({update_id: 4, message}, 'bot', 'fixture_bot');
	expect(turns).toHaveLength(1);
}));

it('expires pairing codes and limits how many wait at once', async () => fixture(async (_store, home) => {
	const now = Date.now();
	const first = await requestPairing(home, '1', 'one', now);
	await requestPairing(home, '2', 'two', now);
	await requestPairing(home, '3', 'three', now);
	expect(await requestPairing(home, '4', 'four', now)).toBeUndefined();
	const later = await requestPairing(home, '4', 'four', now + pairingTtlMs + 1);
	expect(later?.created).toBe(true);
	expect(later?.code).not.toBe(first?.code);
}));

it('ignores strangers in groups and answers allowlisted owners only when addressed in an allowed group', async () => fixture(async (store, home) => {
	const config = await loadConfig(home, true);
	config.telegram = {enabled: true, allowedUsers: ['7'], allowedGroups: ['-100']};
	const {saveConfig} = await import('./config.js');
	await saveConfig(home, config);
	const turns: string[] = [];
	const {gateway, sent} = gatewayFor(store, home, turns);
	const group = {id: -100, type: 'supergroup'};
	await gateway.handle({update_id: 1, message: {text: '@fixture_bot hi there', from: {id: 9}, chat: group}}, 'bot', 'fixture_bot');
	expect(sent).toEqual([]); // No pairing codes leak into groups.
	await gateway.handle({update_id: 2, message: {text: 'chat among friends', from: {id: 7}, chat: group}}, 'bot', 'fixture_bot');
	await gateway.handle({update_id: 3, message: {text: '@fixture_bot đếm cửa sổ', from: {id: 7}, chat: {id: -999, type: 'group'}}}, 'bot', 'fixture_bot');
	expect(turns).toEqual([]);
	await gateway.handle({update_id: 4, message: {text: '@fixture_bot đếm cửa sổ', from: {id: 7}, chat: group}}, 'bot', 'fixture_bot');
	expect(turns).toEqual(['đếm cửa sổ']);
	expect(sent.at(-1)).toEqual({chat: -100, text: 'fixture reply'});
}));

it('runs the terminal setup with key and token checks, keeping secrets out of config', async () => fixture(async (store, home) => {
	const config = await loadConfig(home, true);
	const answers = ['bad-key', 'sk-fixture', '', 'not-a-token', '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij', 'n'];
	const said: string[] = [];
	const request = (async (url: string | URL) => {
		const target = String(url);
		if (target.endsWith('/models')) {
			return new Response(JSON.stringify(store.secret('DEEPSEEK_API_KEY') === 'sk-fixture' ? {data: [{id: 'deepseek-flash'}]} : {}), {status: store.secret('DEEPSEEK_API_KEY') === 'sk-fixture' ? 200 : 401});
		}

		return new Response(JSON.stringify({ok: true, result: target.endsWith('getMe') ? {username: 'antwork_bot', first_name: 'Antwork'} : {url: ''}}));
	}) as typeof fetch;
	const result = await runSetup(home, config, store, {
		ask: async () => answers.shift() ?? '', say: (text) => said.push(text), close() {/* Fixture. */},
	}, request);
	expect(result).toEqual({botUsername: 'antwork_bot', installService: false});
	expect(store.secret('DEEPSEEK_API_KEY')).toBe('sk-fixture');
	expect(store.secret('TELEGRAM_BOT_TOKEN')).toMatch(/^123456:/);
	const saved = await loadConfig(home, true);
	expect(saved.routes.deepseek?.model).toBe('deepseek-flash');
	expect(saved.telegram.enabled).toBe(true);
	expect(JSON.stringify(saved)).not.toContain('sk-fixture');
	expect(said.join('\n')).toContain('pairing approve');
	validateDeepSeekConfig(saved);
}));
