import {createServer, type Server} from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	afterEach, describe, expect, it, vi,
} from 'vitest';
import {BrowserAutomation} from './automation.js';
import {SessionApi} from './api.js';
import {operationSignature, replayHeaders} from './api-data.js';
import {ApiStore} from './api-store.js';
import {LocalJournal} from '../learning/privacy.js';

const cleanups: (() => Promise<void>)[] = [];
// Chromium startup, profile shutdown and Windows key protection contend with the full suite.
const browserTestTimeout = 45000;
afterEach(async () => {
	vi.restoreAllMocks();
	for (const cleanup of cleanups.splice(0).reverse()) {
		// eslint-disable-next-line no-await-in-loop -- Stop browser/network owners before deleting their exact fixture directory.
		await cleanup();
	}
});

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), 'pokemon-api-watch-test-'));
	const requests: {path: string; cookie: string; authorization: string; body: string}[] = [];
	let drop = false;
	const server: Server = createServer(async (request, response) => {
		const path = new URL(request.url ?? '/', 'http://fixture').pathname;
		if (path === '/fixture') {
			response.setHeader('Content-Type', 'text/html');
			response.end(`<title>API fixture</title>
<button id="inbox" onclick="fetch('/api/list?folder=inbox&token=QUERY_SECRET',{headers:{Authorization:'Bearer REQUEST_SECRET'}}).then(r=>r.json()).then(()=>document.querySelector('p').textContent='Inbox complete')">Inbox</button>
<button id="query" onclick="fetch('/api/rpc',{method:'POST',headers:{'Content-Type':'application/json','X-OWA-Action':'FindItem'},body:JSON.stringify({folder:'inbox',limit:10})}).then(r=>r.json()).then(()=>document.querySelector('p').textContent='Query complete')">Search</button>
<button id="item" onclick="fetch('/api/rpc',{method:'POST',headers:{'Content-Type':'application/json','X-OWA-Action':'GetItem'},body:JSON.stringify({folder:'inbox',limit:10})}).then(r=>r.json()).then(()=>document.querySelector('p').textContent='Item complete')">Open item</button>
<p>Ready</p>`);
			return;
		}

		let body = '';
		for await (const chunk of request) {
			body += String(chunk);
		}

		if (path === '/favicon.ico') {
			response.writeHead(204);
			response.end();
			return;
		}

		requests.push({
			path, cookie: request.headers.cookie ?? '', authorization: request.headers.authorization ?? '', body,
		});
		if (path === '/api/drop' && drop) {
			request.socket.destroy();
			return;
		}

		if (path === '/api/redirect') {
			response.writeHead(302, {Location: 'http://127.0.0.1:1/never-send-credentials'});
			response.end();
			return;
		}

		response.writeHead(path === '/api/unauthorized' ? 401 : 200, {'Content-Type': 'application/json'});
		response.end(JSON.stringify({
			items: ['synthetic message'], access_token: 'RESPONSE_SECRET', nested: {cookie: 'COOKIE_IN_RESPONSE'}, count: requests.length,
			echo: ['SESSION_SECRET', 'REQUEST_SECRET', 'QUERY_SECRET'],
		}));
	});
	await new Promise<void>((resolve) => {
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Fixture listener unavailable.');
	}

	const origin = `http://127.0.0.1:${address.port}`;
	let browser = new BrowserAutomation();
	let opened = await browser.launch('chromium', true, join(directory, 'profile'));
	let page = browser.page(opened.page_id);
	await page.context().addCookies([{
		name: 'session', value: 'SESSION_SECRET', url: origin, httpOnly: true, expires: (Date.now() / 1000) + 3600,
	}]);
	await page.goto(`${origin}/fixture`);
	let paused = false;
	const authorize = vi.fn(async () => undefined);
	const reconcile = vi.fn(async () => true);
	const createApi = () => new SessionApi({
		browser, authorize, paused: () => paused, reconcile,
	}, join(directory, 'api'));
	let api = createApi();
	cleanups.push(async () => {
		await api.close();
		await browser.close();
		server.closeAllConnections();
		await new Promise<void>((resolve) => {
			server.close(resolve);
		});
		await rm(directory, {recursive: true, force: true});
	});
	const rows = async () => (await api.catalog(opened.page_id)).operations;
	const waitRows = async (count: number) => {
		await expect.poll(async () => (await rows()).length).toBe(count);
		return rows();
	};

	const demonstrate = async (path: string, method = 'GET') => {
		await page.evaluate(async ({url, method}) => {
			await fetch(url, {method, ...(method === 'POST' ? {headers: {'Content-Type': 'application/json'}, body: '{"message":"synthetic draft"}'} : {})}).catch(() => undefined);
		}, {url: origin + path, method});
	};

	return {
		directory, origin, requests, authorize, reconcile, rows, waitRows, demonstrate,
		get api() {
			return api;
		}, get page() {
			return page;
		}, get pageId() {
			return opened.page_id;
		},
		setPaused(value: boolean) {
			paused = value;
		},
		setDrop(value: boolean) {
			drop = value;
		},
		async restart() {
			await api.close();
			await browser.close();
			browser = new BrowserAutomation();
			opened = await browser.launch('chromium', true, join(directory, 'profile'));
			page = browser.page(opened.page_id);
			await page.goto(`${origin}/fixture`);
			api = createApi();
		},
	};
}

describe('session API demonstrations', () => {
	it('adds and refreshes operations near clicks, protects credentials, and reuses cookies after restart', async () => {
		const f = await fixture();
		await f.api.watchStart(f.pageId, `${f.origin}/api/`);
		await f.page.getByRole('button', {name: 'Inbox', exact: true}).click();
		const [first] = await f.waitRows(1);
		expect(first.trigger).toMatchObject({kind: 'near_click', label: 'Inbox'});
		const catalog = JSON.stringify(await f.api.watchRead(f.pageId));
		for (const secret of ['QUERY_SECRET', 'REQUEST_SECRET', 'SESSION_SECRET']) {
			expect(catalog).not.toContain(secret);
		}

		await f.page.getByRole('button', {name: 'Inbox', exact: true}).click();
		await expect.poll(async () => (await f.rows())[0]?.observations).toBe(2);
		const [updated] = await f.rows();
		expect(updated.operation_id).toBe(first.operation_id);
		expect(updated.revision).toBe(first.revision + 1);
		await expect(f.api.review(f.pageId, first.operation_id, first.revision, 'read')).rejects.toMatchObject({details: {code: 'API_SELECTION_REQUIRED'}});
		await f.api.review(f.pageId, updated.operation_id, updated.revision, 'read');
		await f.api.watchStop(f.pageId);
		const encrypted = await readFile(join(f.directory, 'api/operations/events.enc'), 'utf8');
		expect(encrypted).not.toContain('REQUEST_SECRET');
		expect(encrypted).not.toContain('QUERY_SECRET');
		await f.restart();
		const outcome = await f.api.execute(f.pageId, updated.operation_id, updated.revision, {folder: 'archive'});
		expect(outcome).toMatchObject({outcome: 'success', result: {http_ok: true}, verification_required: false});
		expect(JSON.stringify(outcome)).not.toContain('RESPONSE_SECRET');
		for (const secret of ['SESSION_SECRET', 'REQUEST_SECRET', 'QUERY_SECRET']) {
			expect(JSON.stringify(outcome)).not.toContain(secret);
		}

		expect(f.requests.at(-1)).toMatchObject({authorization: 'Bearer REQUEST_SECRET', cookie: 'session=SESSION_SECRET'});
		expect(f.authorize.mock.calls.length).toBeGreaterThanOrEqual(3);
	}, browserTestTimeout);

	it('distinguishes operations sharing an endpoint and separates background traffic from demonstrations', async () => {
		const f = await fixture();
		await f.api.watchStart(f.pageId, `${f.origin}/api/`);
		await f.demonstrate('/api/background');
		const [background] = await f.waitRows(1);
		expect(background.trigger).toEqual({kind: 'background_or_uncorrelated'});
		await f.page.getByRole('button', {name: 'Search', exact: true}).click();
		await f.waitRows(2);
		await f.page.getByRole('button', {name: 'Open item', exact: true}).click();
		const operations = await f.waitRows(3);
		expect(operations.map((row) => row.operation_label)).toEqual(['GetItem', 'FindItem', '']);
		const query = operations[1];
		const next = await f.api.catalog(f.pageId, undefined, 2000, 2);
		expect(next.operations).toHaveLength(1);
		expect(next.operations[0].operation_id).toBe(background.operation_id);
		await f.api.watchStop(f.pageId);
		await f.api.review(f.pageId, query.operation_id, query.revision, 'read');
		const replay = await f.api.execute(f.pageId, query.operation_id, query.revision, {}, {limit: 5});
		expect(replay.outcome).toBe('success');
		expect(JSON.parse(f.requests.at(-1)?.body ?? '{}')).toEqual({folder: 'inbox', limit: 5});
	}, browserTestTimeout);

	it('requires review and authorization and rejects changed sessions, origins, expiry and unsafe parameters before requests', async () => {
		const f = await fixture();
		await expect(f.api.watchStart(f.pageId, 'https://example.test/')).rejects.toMatchObject({details: {code: 'INVALID_ARGS'}});
		f.authorize.mockRejectedValueOnce(new Error('Denied by owner'));
		await expect(f.api.watchStart(f.pageId, `${f.origin}/api/`)).rejects.toThrow('Denied');
		expect(await f.api.watchRead(f.pageId)).toMatchObject({watching: false});
		await f.api.watchStart(f.pageId, `${f.origin}/api/`);
		await f.page.getByRole('button', {name: 'Inbox', exact: true}).click();
		const [operation] = await f.waitRows(1);
		await f.api.watchStop(f.pageId);
		await expect(f.api.execute(f.pageId, operation.operation_id, operation.revision)).rejects.toMatchObject({details: {code: 'API_REVIEW_REQUIRED'}});
		await f.api.review(f.pageId, operation.operation_id, operation.revision, 'read');
		const count = f.requests.length;
		await expect(f.api.execute(f.pageId, operation.operation_id, operation.revision, {token: 'changed'})).rejects.toMatchObject({details: {code: 'INVALID_ARGS'}});
		await expect(f.api.execute(f.pageId, operation.operation_id, operation.revision, {unknown: 'x'})).rejects.toMatchObject({details: {code: 'INVALID_ARGS'}});
		f.authorize.mockRejectedValueOnce(new Error('Denied by owner'));
		await expect(f.api.execute(f.pageId, operation.operation_id, operation.revision)).rejects.toThrow('Denied');
		f.setPaused(true);
		await expect(f.api.execute(f.pageId, operation.operation_id, operation.revision)).rejects.toMatchObject({details: {code: 'PAUSED'}});
		f.setPaused(false);
		vi.spyOn(Date, 'now').mockReturnValue(operation.expires_at + 1);
		await expect(f.api.execute(f.pageId, operation.operation_id, operation.revision)).rejects.toMatchObject({details: {code: 'AUTH_REFRESH_REQUIRED'}});
		vi.restoreAllMocks();
		await f.page.context().addCookies([{
			name: 'session', value: 'ANOTHER_ACCOUNT', url: f.origin, httpOnly: true,
		}]);
		await expect(f.api.execute(f.pageId, operation.operation_id, operation.revision)).rejects.toMatchObject({details: {code: 'SESSION_CHANGED'}});
		expect(f.requests.length).toBe(count);
		await f.page.goto('about:blank');
		await expect(f.api.execute(f.pageId, operation.operation_id, operation.revision)).rejects.toMatchObject({details: {code: 'SESSION_CHANGED'}});
	}, browserTestTimeout);

	it('blocks uncertain writes across refresh, effect changes and restart; operator reconciliation sends nothing', async () => {
		const f = await fixture();
		await f.api.watchStart(f.pageId, `${f.origin}/api/`);
		await f.demonstrate('/api/write', 'POST');
		const [operation] = await f.waitRows(1);
		await f.api.watchStop(f.pageId);
		await f.api.review(f.pageId, operation.operation_id, operation.revision, 'write');
		expect(await f.api.execute(f.pageId, operation.operation_id, operation.revision)).toMatchObject({outcome: 'unknown', verification_required: true});
		const count = f.requests.length;
		await f.api.review(f.pageId, operation.operation_id, operation.revision, 'read');
		await expect(f.api.execute(f.pageId, operation.operation_id, operation.revision)).rejects.toMatchObject({details: {code: 'REPLAY_BLOCKED'}});
		await f.restart();
		await expect(f.api.execute(f.pageId, operation.operation_id, operation.revision, {}, {message: 'changed draft'})).rejects.toMatchObject({details: {code: 'REPLAY_BLOCKED'}});
		f.reconcile.mockResolvedValueOnce(false);
		await expect(f.api.reconcile(f.pageId, operation.operation_id, operation.revision)).rejects.toMatchObject({details: {code: 'REPLAY_BLOCKED'}});
		expect(await f.api.reconcile(f.pageId, operation.operation_id, operation.revision)).toEqual({reconciled: true, executed: false});
		expect(f.requests.length).toBe(count);
	}, browserTestTimeout);

	it('does not follow redirects and reports expired login without automatic retries', async () => {
		const f = await fixture();
		await f.api.watchStart(f.pageId, `${f.origin}/api/`);
		await f.demonstrate('/api/unauthorized');
		await f.waitRows(1);
		await f.demonstrate('/api/redirect');
		const [redirect, auth] = await f.waitRows(2);
		await f.api.watchStop(f.pageId);
		await f.api.review(f.pageId, auth.operation_id, auth.revision, 'read');
		const result = await f.api.execute(f.pageId, auth.operation_id, auth.revision);
		expect(result).toMatchObject({outcome: 'failed', result: {status: 401, authentication_required: true}});
		await expect(f.api.execute(f.pageId, auth.operation_id, auth.revision)).rejects.toMatchObject({details: {code: 'AUTH_REFRESH_REQUIRED'}});
		await f.api.review(f.pageId, redirect.operation_id, redirect.revision, 'read');
		const blocked = await f.api.execute(f.pageId, redirect.operation_id, redirect.revision);
		expect(blocked).toMatchObject({outcome: 'unknown', result: {redirect_blocked: true}});
		expect(f.requests.filter((request) => request.path === '/api/unauthorized')).toHaveLength(2);
		expect(f.requests.filter((request) => request.path === '/api/redirect')).toHaveLength(2);
	}, browserTestTimeout);

	it('blocks transport loss across restart without dispatching a duplicate request', async () => {
		const f = await fixture();
		await f.api.watchStart(f.pageId, `${f.origin}/api/`);
		await f.demonstrate('/api/drop', 'POST');
		const [operation] = await f.waitRows(1);
		await f.api.watchStop(f.pageId);
		await f.api.review(f.pageId, operation.operation_id, operation.revision, 'write');
		f.setDrop(true);
		await expect(f.api.execute(f.pageId, operation.operation_id, operation.revision)).rejects.toMatchObject({details: {code: 'ACTION_OUTCOME_UNKNOWN'}});
		await f.restart();
		await expect(f.api.execute(f.pageId, operation.operation_id, operation.revision)).rejects.toMatchObject({details: {code: 'REPLAY_BLOCKED'}});
		expect(f.requests.filter((request) => request.path === '/api/drop')).toHaveLength(2);
	}, browserTestTimeout);

	it('ignores paused demonstrations and login payloads; oversized previews stay observable without replay', async () => {
		const f = await fixture();
		await f.api.watchStart(f.pageId, `${f.origin}/api/`);
		f.setPaused(true);
		await f.demonstrate('/api/paused');
		f.setPaused(false);
		await f.demonstrate('/api/login', 'POST');
		await f.page.evaluate(async () => {
			await fetch('/api/rpc', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"password":"LOGIN_SECRET"}'});
			await fetch('/api/large', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: 'x'.repeat(9000)})});
		});
		const [large] = await f.waitRows(1);
		expect(large).toMatchObject({review_available: false, replayable: false});
		await expect(f.api.review(f.pageId, large.operation_id, large.revision, 'read')).rejects.toMatchObject({details: {code: 'APPROVAL_DISPLAY_TOO_LARGE'}});
		const bounded = await f.api.watchRead(f.pageId, 1000);
		expect(JSON.stringify(bounded, null, 2).length).toBeLessThanOrEqual(1000);
		expect(bounded).toMatchObject({total_operations: 1, truncated: true});
		await f.api.watchStop(f.pageId);
	}, browserTestTimeout);
});

describe('capture template guards', () => {
	it('drops transport cookies and keeps different RPC labels distinct', () => {
		expect(replayHeaders({
			cookie: 'PRIVATE', 'set-cookie': 'PRIVATE', host: 'wrong', authorization: 'Bearer private', 'content-type': 'application/json',
		})).toEqual({authorization: 'Bearer private', 'content-type': 'application/json'});
		const headers = {'content-type': 'application/json'};
		expect(operationSignature('profile', 'https://example.test/rpc', 'POST', headers, '{"operationName":"ReadInbox"}').signature)
			.not.toBe(operationSignature('profile', 'https://example.test/rpc', 'POST', headers, '{"operationName":"SendMail"}').signature);
	});

	it('serializes concurrent observations and invalidates review when request headers change', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'pokemon-api-store-test-'));
		const store = new ApiStore(new LocalJournal(directory));
		cleanups.push(async () => {
			await store.close();
			await rm(directory, {recursive: true, force: true});
		});
		const base = {
			profile: 'profile', origin: 'https://example.test', url: 'https://example.test/rpc', method: 'POST' as const,
			headers: {'content-type': 'application/json', authorization: 'Bearer FIRST_SECRET'}, body: '{"operationName":"ReadInbox"}',
			cookie_hash: 'hash', cookie_names: ['session'], seen: Date.now(), expires: Date.now() + 60000, status: 200, click: null,
		};
		const input = {...base, ...operationSignature(base.profile, base.url, base.method, base.headers, base.body)};
		await Promise.all(Array.from({length: 6}, async () => store.put(input)));
		const [first] = await store.list();
		expect(first).toMatchObject({observations: 6, revision: 6, effect: 'unreviewed'});
		await store.review(first.id, first.revision, 'read');
		const unchanged = await store.put(input);
		expect(unchanged.effect).toBe('read');
		const updated = await store.put({...input, headers: {...input.headers, authorization: 'Bearer SECOND_SECRET'}});
		expect(updated).toMatchObject({id: first.id, revision: 8, effect: 'unreviewed'});
	});
});
