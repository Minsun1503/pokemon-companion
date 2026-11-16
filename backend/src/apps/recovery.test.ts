import {createServer, type Server} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
	afterEach, describe, expect, it, vi,
} from 'vitest';
import {PokemonRuntime} from '../pokemon/runtime.js';
import {ConnectionStore} from './connections.js';
import {inspectApp, inspectSchema} from '../desktop/inspect.js';
import {callDiscoveredApi, discoverApi} from './local-api.js';

vi.setConfig({testTimeout: 30000}); // Real current-user DPAPI subprocesses are slower under parallel test load.

const identity = {
	image_path: 'C:/Apps/api-test.exe', process_id: 42, process_started: '1', version: '1',
};
const folders: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
	await Promise.all(servers.splice(0).map(async (server) => new Promise<void>((resolve) => {
		server.close(() => {
			resolve();
		});
	})));
	await Promise.all(folders.splice(0).map(async (folder) => rm(folder, {recursive: true, force: true})));
	vi.unstubAllEnvs();
});
async function setup(handler: Parameters<typeof createServer>[0]) {
	const server = createServer(handler);
	servers.push(server);
	await new Promise<void>((resolve) => {
		server.listen(0, '127.0.0.1', resolve);
	});
	const endpoint = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
	const folder = await mkdtemp(join(tmpdir(), 'pokemon-api-recovery-'));
	folders.push(folder);
	vi.stubEnv('POKEMON_ACTIONS_DIR', folder);
	return {endpoint, file: join(folder, 'connections.json')};
}

function runtime(file: string, endpoint: string) {
	const value = new PokemonRuntime();
	Object.defineProperty(value, 'connections', {value: new ConnectionStore(file)});
	const native = vi.spyOn(value.windows, 'request').mockImplementation(async (args) => {
		if (args.action === 'app_identity') {
			return identity;
		}

		if (args.action === 'endpoint_owner') {
			return {owns: true};
		}

		if (args.action === 'cdp_ports') {
			return {listeners: [{endpoint, process_id: 42}]};
		}

		return {nodes: []};
	});
	return {value, native};
}

describe('catalog-only API discovery and explicit execution', () => {
	it.each(['path', 'schema'])('never replays an operation after a %s update; renewed selection is required', async (update) => {
		let version = 1;
		let calls = 0;
		const {endpoint, file} = await setup((request, response) => {
			if (request.url === '/openapi.json') {
				response.end(JSON.stringify({
					openapi: '3.0.0', paths: {
						[`/v${update === 'path' ? version : 1}/messages`]: {get: {operationId: 'readMessages', responses: {200: {content: {'application/json': {schema: {type: 'object', required: [version === 1 ? 'messages' : 'items']}}}}}}},
					},
				}));
			} else {
				calls += 1;
				response.end(JSON.stringify(version === 1 ? {messages: ['hello']} : {items: ['updated']}));
			}
		});
		const args = inspectSchema.parse({
			action: 'read', app_id: 'fixture', window_id: '1', window_ref: 'a'.repeat(32), api_operation: 'readMessages', capture_fallback: false,
		});
		const first = runtime(file, endpoint);
		const catalog = await inspectApp(first.value, args);
		expect(catalog).toMatchObject({method: 'api', data: {selection_required: true}});
		expect(calls).toBe(0);
		vi.stubEnv('POKEMON_API_EXECUTION', 'host-authorized');
		const {fingerprint} = (catalog.data as {fingerprint: string});
		expect(await inspectApp(first.value, {...args, api_fingerprint: fingerprint})).toMatchObject({data: {text: '{"messages":["hello"]}'}});
		expect(calls).toBe(1);
		version = 2;
		const changed = await inspectApp(first.value, {...args, api_fingerprint: fingerprint});
		expect(changed).toMatchObject({method: 'api', rediscovered: true, data: {selection_required: true}});
		expect(calls).toBe(1);
		const renewed = (changed.data as {fingerprint: string}).fingerprint;
		expect(renewed).not.toBe(fingerprint);
		expect(await inspectApp(first.value, {...args, api_fingerprint: renewed})).toMatchObject({data: {text: '{"items":["updated"]}'}});
		expect(calls).toBe(2);
	});
	it('never invokes shutdown by discovery or forged model approval', async () => {
		let mutations = 0;
		const {endpoint} = await setup((request, response) => {
			if (request.url === '/openapi.json') {
				response.end(JSON.stringify({openapi: '3.0.0', paths: {'/api/shutdown': {get: {operationId: 'shutdown'}}, '/api/status': {get: {operationId: 'status'}}}}));
			} else {
				mutations += 1;
				response.end('{}');
			}
		});
		vi.stubEnv('POKEMON_API_EXECUTION', '');
		const api = await discoverApi(endpoint);
		expect(api.operations.map((item) => item.id)).toEqual(['status']);
		await expect(callDiscoveredApi(api, 'status', 1000, undefined, api.fingerprint)).rejects.toMatchObject({details: {code: 'APPROVAL_REQUIRED'}});
		expect(mutations).toBe(0);
		expect(inspectSchema.safeParse({
			action: 'read', window_id: '1', window_ref: 'a'.repeat(32), approved: true,
		}).success).toBe(false);
	});
	it('records unknown response outcomes and blocks repeated operation after malformed dispatch', async () => {
		let count = 0;
		const {endpoint} = await setup((request, response) => {
			if (request.url === '/openapi.json') {
				response.end(JSON.stringify({openapi: '3.0.0', paths: {'/messages': {get: {operationId: 'messages'}}}}));
			} else {
				count += 1;
				response.end('broken-json-after-effect');
			}
		});
		vi.stubEnv('POKEMON_API_EXECUTION', 'host-authorized');
		const api = await discoverApi(endpoint);
		await expect(callDiscoveredApi(api, 'messages', 1000, undefined, api.fingerprint)).rejects.toMatchObject({details: {code: 'API_OUTCOME_UNKNOWN', disposition: {retry: 'unsafe'}}});
		await expect(callDiscoveredApi(api, 'messages', 1000, undefined, api.fingerprint)).rejects.toMatchObject({details: {code: 'REPLAY_BLOCKED'}});
		expect(count).toBe(1);
	});
	it('rejects a rebound cached CDP port before connecting and saves a verified replacement', async () => {
		const {file} = await setup((_request, response) => response.end('{}'));
		await new ConnectionStore(file).put('fixture', identity, {identity, updated_at: 0, cdp: {endpoint: 'http://127.0.0.1:9001', page_url: 'https://example.com/'}});
		const {value, native} = runtime(file, 'http://127.0.0.1:9002');
		native.mockImplementation(async (args) => args.action === 'app_identity' ? identity : args.action === 'endpoint_owner' ? {owns: args.text === 'http://127.0.0.1:9002'} : {listeners: [{endpoint: 'http://127.0.0.1:9002'}]});
		const connect = vi.spyOn(value.browser, 'connect').mockImplementation(async (_endpoint, validate) => {
			await validate?.();
			return {session_id: 'session', owned: false, pages: [{page_id: 'page', url: 'https://example.com/?token=must-not-persist'}]};
		});
		vi.spyOn(value.browser, 'snapshot').mockResolvedValue({
			page_id: 'page', url: 'https://example.com/?token=must-not-persist', title: 'Example', nodes: [], matched: 0, truncated: false, text: {text: 'hello', truncated: false},
		});
		expect(await inspectApp(value, inspectSchema.parse({
			action: 'read', app_id: 'fixture', window_id: '1', window_ref: 'a'.repeat(32),
		}))).toMatchObject({method: 'cdp', rediscovered: true});
		expect(connect).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:9002', expect.any(Function));
		expect((await new ConnectionStore(file).get('fixture', identity))?.cdp).toEqual({endpoint: 'http://127.0.0.1:9002/', page_url: 'https://example.com/'});
	});
});
