import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCipheriv, randomBytes} from 'node:crypto';
import {protectCurrentUser} from '../learning/privacy.js';
import {
	afterEach, describe, expect, it, vi,
} from 'vitest';
import {PokemonRuntime} from '../pokemon/runtime.js';
import {inspectApp, inspectSchema, readApiCapture} from './inspect.js';
import {rejectedAction} from '../utils/errors.js';

vi.setConfig({testTimeout: 30000}); // Encrypt/decrypt fixtures using real Windows DPAPI.

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map(async (path) => rm(path, {recursive: true, force: true})));
});
const args = () => inspectSchema.parse({action: 'read', window_id: '123', window_ref: 'a'.repeat(32)});
const identity = {
	image_path: 'C:/Apps/test.exe', process_id: 42, process_started: '1', version: '1',
};
function makeRuntime() {
	const runtime = new PokemonRuntime();
	vi.spyOn(runtime.connections, 'get').mockResolvedValue(undefined);
	vi.spyOn(runtime.connections, 'put').mockResolvedValue();
	vi.spyOn(runtime.connections, 'invalidate').mockResolvedValue();
	return runtime;
}

async function fixture(processId = 42, at = Date.now()) {
	const path = await mkdtemp(join(tmpdir(), 'pokemon-api-test-'));
	directories.push(path);
	const file = join(path, 'capture.json');
	const payload = JSON.stringify({
		process_id: processId, captured_at: at, events: [{
			at, url: 'https://example.com/api/messages', status: 200, body: '{"message":"hello"}',
		}],
	});
	const key = randomBytes(32);
	const nonce = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, nonce);
	cipher.setAAD(Buffer.from('pokemon-api-capture-v1'));
	const ciphertext = Buffer.concat([nonce, cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
	await writeFile(`${file}.key`, process.platform === 'win32' ? protectCurrentUser(key, false) : key);
	await writeFile(file, JSON.stringify({
		version: 1, format: 'pokemon-api-capture-aes-gcm', expires_at: at + 300000, data: ciphertext.toString('base64'),
	}));
	return file;
}

describe('desktop source selection', () => {
	it('stops at successful CDP without reading API or UIA', async () => {
		const runtime = makeRuntime();
		const native = vi.spyOn(runtime.windows, 'request').mockImplementation(async (request) => request.action === 'app_identity' ? identity : {ports: [9222], process_id: 42});
		vi.spyOn(runtime.browser, 'connect').mockResolvedValue({session_id: 'session', pages: [{page_id: 'page', url: 'https://example.com'}], owned: false});
		vi.spyOn(runtime.browser, 'snapshot').mockResolvedValue({
			page_id: 'page', url: 'https://example.com', title: 'Example', nodes: [], matched: 0, truncated: false, text: {text: 'hello', truncated: false},
		});
		expect(await inspectApp(runtime, args())).toMatchObject({method: 'cdp', attempts: [{method: 'cdp', available: true}]});
		expect(native.mock.calls.map((call) => call[0].action)).toEqual(['app_identity', 'cdp_ports']);
	});
	it('falls through in the requested order, keeping Win32 and UIA separate', async () => {
		const runtime = makeRuntime();
		const native = vi.spyOn(runtime.windows, 'request').mockImplementation(async (request) => {
			if (request.action === 'app_identity') {
				return identity;
			}

			if (request.action === 'cdp_ports') {
				return {ports: [], process_id: 42};
			}

			if (request.action === 'win32_text') {
				return {available: false};
			}

			return {nodes: [{name: 'Hello'}]};
		});
		const result = await inspectApp(runtime, args());
		expect(result.method).toBe('uia');
		expect(result.attempts.map((item) => [item.method, item.available])).toEqual([['cdp', false], ['api', false], ['win32', false], ['uia', true]]);
		expect(native.mock.calls.map((call) => call[0].action)).toEqual(['app_identity', 'cdp_ports', 'win32_text', 'get_ui']);
	});
	it('selects a scoped API response before touching HWND text', async () => {
		const runtime = makeRuntime();
		const native = vi.spyOn(runtime.windows, 'request').mockImplementation(async (request) => request.action === 'app_identity' ? identity : {ports: [], process_id: 42});
		const file = await fixture();
		const result = await inspectApp(runtime, {...args(), api_capture_file: file, api_url_filter: '/api/messages'});
		expect(result).toMatchObject({method: 'api', data: {text: '{"message":"hello"}'}});
		expect(native).toHaveBeenCalledTimes(2);
	});
	it('does not swallow cancellation or stale window identities', async () => {
		const runtime = new PokemonRuntime();
		const native = vi.spyOn(runtime.windows, 'request').mockRejectedValue(rejectedAction('STALE_REF', 'Window changed.'));
		await expect(inspectApp(runtime, args())).rejects.toThrow('Window changed.');
		expect(native).toHaveBeenCalledTimes(1);
		runtime.companion.state.paused = true;
		await expect(inspectApp(runtime, args())).rejects.toThrow('paused');
		expect(native).toHaveBeenCalledTimes(1);
	});
	it('invalidates connections after an executable version change', async () => {
		const runtime = makeRuntime();
		vi.mocked(runtime.connections.get).mockResolvedValue({identity: {...identity, version: 'old'}, updated_at: 1, cdp: {endpoint: 'http://127.0.0.1:9001'}});
		const native = vi.spyOn(runtime.windows, 'request').mockImplementation(async (request) => request.action === 'app_identity' ? identity : {ports: [9002]});
		const connect = vi.spyOn(runtime.browser, 'connect').mockResolvedValue({session_id: 'session', pages: [{page_id: 'page', url: 'https://example.com'}], owned: false});
		vi.spyOn(runtime.browser, 'snapshot').mockResolvedValue({
			page_id: 'page', url: 'https://example.com', title: 'Example', nodes: [], matched: 0, truncated: false, text: {text: 'hello', truncated: false},
		});
		expect(await inspectApp(runtime, args())).toMatchObject({method: 'cdp', rediscovered: true, cache_hit: false});
		expect(connect).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:9002', expect.any(Function));
		expect(native.mock.calls.map((call) => call[0].action)).toEqual(['app_identity', 'cdp_ports']);
	});
	it('stops fallback when cancellation arrives during a failed CDP probe', async () => {
		const runtime = makeRuntime();
		const controller = new AbortController();
		const native = vi.spyOn(runtime.windows, 'request').mockImplementation(async (request) => request.action === 'app_identity' ? identity : {ports: [9002]});
		vi.spyOn(runtime.browser, 'connect').mockImplementation(async () => {
			controller.abort();
			throw new Error('Connection ended');
		});
		await expect(inspectApp(runtime, args(), controller.signal)).rejects.toThrow('cancelled');
		expect(native.mock.calls.map((call) => call[0].action)).toEqual(['app_identity', 'cdp_ports']);
	});
});
describe('API capture validation', () => {
	it('rejects mismatched processes and stale captures', async () => {
		await expect(readApiCapture(await fixture(9), 42, '/api', 8000)).rejects.toThrow('different application');
		await expect(readApiCapture(await fixture(42, Date.now() - 600000), 42, '/api', 8000)).rejects.toThrow('stale');
	});
	it('never treats packet metadata or an unrelated URL as usable content', async () => {
		await expect(readApiCapture(await fixture(), 42, '/unrelated', 8000)).rejects.toThrow('No recent matching');
	});
});
