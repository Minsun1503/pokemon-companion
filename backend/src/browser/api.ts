import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {type Page, type Response} from 'playwright';
import {type BrowserAutomation} from './automation.js';
import {ApiStore, type CapturedOperation} from './api-store.js';
import {LocalJournal} from '../learning/privacy.js';
import {ActionJournal} from './actions.js';
import {
	approvalIntent, hashState, visibleText, type ApprovalIntent,
} from '../security/approval.js';
import {rejectedAction} from '../utils/errors.js';
import {
	applyParameters, boundedCatalog, cookieIdentity, endpoint, operationSignature, preview, protector, replayHeaders, secretField, summary,
} from './api-data.js';
import {untrusted} from '../utils/untrusted.js';

type Click = {id: string; label: string; at: number};
type Watch = {id: string; pageId: string; page: Page; prefix: string; profile: string; ttl: number;
	clicks: Click[]; listener: (response: Response) => void; dropped: number; skipped: number; error?: string;};
type ApiHost = {browser: BrowserAutomation; authorize: (intent: ApprovalIntent, refresh: () => Promise<ApprovalIntent>) => Promise<void>;
	paused: () => boolean; reconcile: (intent: ApprovalIntent) => Promise<boolean>;};
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const authenticationPath = /(?:^|\/)(?:login|signin|sign-in|oauth2?|authorize|password|token)(?:\/|\.|$)/i;

/** Observe demonstrations without exporting session secrets or automatically replaying anything. */
export class SessionApi {
	private readonly watches = new Map<string, Watch>();
	private readonly observers = new WeakMap<Page, string>();
	private queue: Promise<unknown> = Promise.resolve();
	private pending = 0;
	private closing = false;
	private readonly store: ApiStore;
	private readonly actions: ActionJournal;
	constructor(private readonly host: ApiHost, directory = process.env.POKEMON_API_DIR || join(process.env.LOCALAPPDATA || homedir(), 'pokemon-companion', 'session-api')) {
		this.store = new ApiStore(new LocalJournal(join(directory, 'operations')));
		this.actions = new ActionJournal(new LocalJournal(join(directory, 'actions')));
	}

	async watchStart(pageId: string, prefix: string, ttlMinutes = 1440, signal?: AbortSignal) {
		await this.check(pageId, signal);
		const page = this.host.browser.page(pageId);
		const scope = new URL(prefix);
		if (!['http:', 'https:'].includes(scope.protocol) || scope.username || scope.password || scope.search || scope.hash
			|| new URL(page.url()).origin !== scope.origin) {
			throw rejectedAction('INVALID_ARGS', 'Watch an HTTP(S) prefix on the current page origin, without credentials, query or fragment.');
		}

		if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 10080) {
			throw rejectedAction('INVALID_ARGS', 'Capture retention must be between one minute and seven days.');
		}

		const profile = await this.host.browser.sessionIdentity(pageId);
		const refresh = async () => {
			await this.check(pageId, signal);
			if (new URL(page.url()).origin !== scope.origin) {
				throw rejectedAction('SESSION_CHANGED', 'Page moved to another origin before watching.');
			}

			return {...approvalIntent('api', 'watch_start', endpoint(prefix), prefix, '', {profile, origin: scope.origin}, {profile, prefix}), wait_for_decision: true};
		};

		await this.host.authorize(await refresh(), refresh);
		await refresh();
		await this.watchStop(pageId);
		if (this.watches.size >= 8) {
			throw rejectedAction('RATE_LIMITED', 'At most eight pages can be watched. Stop another watcher first.');
		}

		await this.observeClicks(page);
		const watch: Watch = {
			id: randomUUID(), pageId, page, prefix: scope.href, profile, ttl: ttlMinutes * 60000,
			clicks: [], listener: () => undefined, dropped: 0, skipped: 0,
		};
		watch.listener = (response) => {
			if (this.closing || this.host.paused() || this.watches.get(pageId) !== watch || new URL(page.url()).origin !== scope.origin) {
				return;
			}

			const request = response.request();
			const url = new URL(response.url());
			if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname) || !['xhr', 'fetch'].includes(request.resourceType())) {
				return;
			}

			if (this.pending >= 32) {
				watch.dropped += 1;
				return;
			}

			this.pending += 1;
			this.queue = this.queue.then(async () => this.capture(watch, response)).catch(() => {
				watch.error = 'Capture could not be saved; check the encrypted store and browser session.';
				watch.page.off('response', watch.listener);
			}).finally(() => {
				this.pending -= 1;
			});
		};

		this.watches.set(pageId, watch);
		page.on('response', watch.listener);
		return {
			watching: true, watch_id: watch.id, url_prefix: endpoint(prefix), expires_in_minutes: ttlMinutes,
			cookies: 'remain in the browser session', request_details: 'encrypted locally', automatic_replay: false,
		};
	}

	async watchRead(pageId: string, maxChars = 8000, offset = 0) {
		await this.queue;
		const watch = this.watches.get(pageId);
		if (!watch) {
			return {watching: false, operations: []};
		}

		const scope = new URL(watch.prefix);
		const rows = (await this.store.list()).filter((row) => row.profile === watch.profile && row.origin === scope.origin && new URL(row.url).pathname.startsWith(scope.pathname));
		const protect = await protector(watch.page.context(), scope.origin, rows);
		return boundedCatalog({
			watching: !watch.error && !watch.page.isClosed(), watch_id: watch.id, paused: this.host.paused(),
			dropped: watch.dropped, skipped: watch.skipped, error: watch.error,
			correlation: 'Timing evidence only; a request near a click may still be background traffic.', provenance: untrusted(scope.origin, 'browser request observations'),
		}, rows.reverse().map((row) => protect(summary(row))), watch.clicks.slice(-20).map((click) => protect(click)), maxChars, offset);
	}

	async watchStop(pageId: string) {
		const watch = this.watches.get(pageId);
		if (watch) {
			watch.page.off('response', watch.listener);
			await this.queue;
			this.watches.delete(pageId);
		}

		return {watching: false};
	}

	async catalog(pageId: string, signal?: AbortSignal, maxChars = 8000, offset = 0) {
		await this.check(pageId, signal);
		await this.queue;
		const profile = await this.host.browser.sessionIdentity(pageId);
		const {origin} = new URL(this.host.browser.page(pageId).url());
		const rows = (await this.store.list()).filter((row) => row.profile === profile && row.origin === origin);
		const protect = await protector(this.host.browser.page(pageId).context(), origin, rows);
		return boundedCatalog({
			provenance: untrusted(origin, 'saved browser request catalog'),
		}, rows.reverse().map((row) => protect(summary(row))), [], maxChars, offset);
	}

	async review(pageId: string, operationId: string, revision: number, effect: 'read' | 'write', signal?: AbortSignal) {
		const refresh = async () => {
			const row = await this.selected(pageId, operationId, revision, signal);
			const protect = await protector(this.host.browser.page(pageId).context(), row.origin, [row]);
			return approvalIntent('api', `review:${effect}`, row.label || endpoint(row.url), row.origin, protect(preview(row)), {revision, cookie_hash: row.cookie_hash, request_hash: hashState([row.url, row.headers, row.body])}, {profile: row.profile, operation: row.id, effect});
		};

		await this.host.authorize(await refresh(), refresh);
		await refresh();
		await this.store.review(operationId, revision, effect);
		return {
			operation_id: operationId, revision, reviewed_effect: effect, executed: false,
		};
	}

	async inspect(pageId: string, operationId: string, revision: number, signal?: AbortSignal) {
		const row = await this.selected(pageId, operationId, revision, signal);
		const protect = await protector(this.host.browser.page(pageId).context(), row.origin, [row]);
		return {
			operation_id: row.id, revision: row.revision, request_preview: protect(preview(row)), executed: false,
			provenance: untrusted(row.origin, 'captured request preview'),
		};
	}

	async execute(pageId: string, operationId: string, revision: number, query: Record<string, string> = {}, json: Record<string, unknown> = {}, maxChars = 8000, signal?: AbortSignal) {
		const refresh = async () => {
			const row = await this.selected(pageId, operationId, revision, signal);
			if (row.effect === 'unreviewed') {
				throw rejectedAction('API_REVIEW_REQUIRED', 'Review the captured request and classify its effect before execution.');
			}

			const request = applyParameters(row, query, json);
			const protect = await protector(this.host.browser.page(pageId).context(), row.origin, [request]);
			return {
				row: request, intent: approvalIntent('api', `execute:${row.effect}`, row.label || endpoint(row.url), row.origin, protect(preview(request)), {revision, cookie_hash: row.cookie_hash, request_hash: hashState([request.url, request.headers, request.body])}, {profile: row.profile, operation: row.id}, {operationClass: 'execute'}),
			};
		};

		const {row, intent} = await refresh();
		if (await this.actions.blocked(intent.scope_hash)) {
			throw rejectedAction('REPLAY_BLOCKED', 'An earlier request has an uncertain outcome. Reconcile it before another execution.');
		}

		await this.host.authorize(intent, async () => (await refresh()).intent);
		if ((await refresh()).intent.digest !== intent.digest) {
			throw rejectedAction('APPROVAL_STATE_CHANGED', 'Request or session changed before dispatch.');
		}

		const page = this.host.browser.page(pageId);
		const protect = await protector(page.context(), row.origin, [row]);
		let authFailure = false;
		const outcome = await this.actions.run(intent.digest, async () => {
			await this.check(pageId, signal);
			if ((await refresh()).intent.digest !== intent.digest) {
				throw rejectedAction('APPROVAL_STATE_CHANGED', 'Request or session changed before dispatch.');
			}

			let response;
			try {
				// Cookie values are supplied by Playwright's shared browser cookie jar, never a template or caller.
				response = await page.context().request.fetch(row.url, {
					method: row.method, headers: row.headers,
					...(row.body === null ? {} : {data: row.body}), maxRedirects: 0, maxRetries: 0, timeout: 20000,
				});
				const status = response.status();
				await this.check(pageId, signal);
				authFailure = status === 401 || status === 403;
				const raw = await response.body();
				if (raw.length > 2 * 1024 * 1024) {
					throw new Error('Buffered response exceeds the accepted response size.');
				}

				let data: unknown;
				try {
					data = JSON.parse(raw.toString('utf8')) as unknown;
				} catch {
					data = null;
				}

				const protectResponse = await protector(page.context(), row.origin, [row]);
				const text = data === null ? '[Non-JSON response withheld; inspect it in the browser.]' : JSON.stringify(protectResponse(data));
				return {
					status, http_ok: status >= 200 && status < 300, json_response: data !== null,
					text: text.slice(0, maxChars), truncated: text.length > maxChars,
					authentication_required: authFailure, redirect_blocked: status >= 300 && status < 400,
				};
			} finally {
				await response?.dispose();
			}
		}, (result) => row.effect === 'read' && ((result.http_ok && result.json_response) || authFailure), intent.action_id, intent.scope_hash);
		if (authFailure) {
			await this.store.expire(row.id, revision);
		}

		return protect({
			...outcome, ...(authFailure ? {outcome: 'failed'} : {}), operation_id: row.id, method: row.method, endpoint: endpoint(row.url),
			verification_required: row.effect === 'write' || outcome.verification_required,
			provenance: untrusted(row.origin, 'explicit session API execution'),
		}) as typeof outcome & {operation_id: string; method: string; endpoint: string; provenance: unknown};
	}

	async reconcile(pageId: string, operationId: string, revision: number, signal?: AbortSignal) {
		const row = await this.selected(pageId, operationId, revision, signal);
		const protect = await protector(this.host.browser.page(pageId).context(), row.origin, [row]);
		const intent = approvalIntent('api', `execute:${row.effect}`, row.label || endpoint(row.url), row.origin, protect(preview(row)), {revision, cookie_hash: row.cookie_hash}, {profile: row.profile, operation: row.id}, {operationClass: 'execute'});
		if (!await this.actions.blocked(intent.scope_hash)) {
			return {reconciled: false, blocked: false};
		}

		if (!await this.host.reconcile({...intent, reconciliation: true})) {
			throw rejectedAction('REPLAY_BLOCKED', 'Operator reconciliation was not confirmed; no request was sent.');
		}

		await this.selected(pageId, operationId, revision, signal);
		await this.actions.reconcile(intent.scope_hash);
		return {reconciled: true, executed: false};
	}

	async close() {
		this.closing = true;
		for (const watch of this.watches.values()) {
			watch.page.off('response', watch.listener);
		}

		await this.queue;
		this.watches.clear();
		await this.store.close();
		await this.actions.close();
	}

	private async check(pageId: string, signal?: AbortSignal) {
		if (this.closing || signal?.aborted || this.host.paused()) {
			throw rejectedAction(signal?.aborted ? 'CANCELLED' : 'PAUSED', 'API access is stopped, paused or cancelled.');
		}

		await this.host.browser.validatePage(pageId);
	}

	private async selected(pageId: string, operationId: string, revision: number, signal?: AbortSignal) {
		await this.check(pageId, signal);
		await this.queue;
		const row = (await this.store.list()).find((entry) => entry.id === operationId);
		if (row?.revision !== revision) {
			throw rejectedAction('API_SELECTION_REQUIRED', 'Select an operation ID and its current revision from the catalog.');
		}

		const page = this.host.browser.page(pageId);
		if (await this.host.browser.sessionIdentity(pageId) !== row.profile || new URL(page.url()).origin !== row.origin) {
			throw rejectedAction('SESSION_CHANGED', 'Saved operation belongs to another browser profile or origin.');
		}

		if (row.expires <= Date.now()) {
			throw rejectedAction('AUTH_REFRESH_REQUIRED', 'Saved request expired. Demonstrate the action again to refresh its template.');
		}

		if ((await cookieIdentity(page.context(), row.origin)).hash !== row.cookie_hash) {
			throw rejectedAction('SESSION_CHANGED', 'Browser cookies changed. Demonstrate and review the action again in the current account.');
		}

		if (row.body_type === 'unsupported') {
			throw rejectedAction('API_UNSUPPORTED', 'Binary, multipart and unsupported bodies can be observed but cannot be replayed.');
		}

		if (preview(row).length > 8000) {
			throw rejectedAction('APPROVAL_DISPLAY_TOO_LARGE', 'Captured request cannot fit a complete review. Demonstrate a smaller request.');
		}

		return row;
	}

	private async capture(watch: Watch, response: Response) {
		if (this.host.paused()) {
			watch.skipped += 1;
			return;
		}

		const request = response.request();
		const method = request.method();
		const url = new URL(response.url());
		const body = request.postData();
		if (!methods.has(method) || authenticationPath.test(url.pathname) || url.username || url.password
			|| (body && (body.length > 64000 || /(?:"|&|^)(?:password|passwd|client_secret|grant_type)(?:"|=)/i.test(body)))) {
			watch.skipped += 1;
			return;
		}

		const headers = replayHeaders(await request.allHeaders());
		if (JSON.stringify(headers).length > 16000) {
			watch.skipped += 1;
			return;
		}

		const start = request.timing().startTime;
		const click = [...watch.clicks].reverse().find((item) => start >= item.at && start - item.at <= 3000);
		const identity = await cookieIdentity(watch.page.context(), url.origin);
		const credentialSnapshot = Object.keys(headers).some((key) => secretField.test(key)) || [...url.searchParams.keys()].some((key) => secretField.test(key))
			|| Boolean(body && /(?:"|&|^)(?:[\w-]*(?:token|canary|csrf|xsrf|secret)[\w-]*)(?:"|=)/i.test(body));
		const seen = Date.now();
		await this.store.put({
			...operationSignature(watch.profile, url.href, method, headers, body), profile: watch.profile, origin: url.origin,
			url: url.href, method: method as CapturedOperation['method'], headers, body, cookie_hash: identity.hash, cookie_names: identity.names,
			seen, expires: seen + Math.min(watch.ttl, credentialSnapshot ? 300000 : watch.ttl), status: response.status(),
			click: click ? {id: click.id, label: click.label, delay_ms: Math.max(0, start - click.at)} : null,
		});
	}

	private async observeClicks(page: Page) {
		let binding = this.observers.get(page);
		if (binding) {
			return;
		}

		if (!binding) {
			binding = `__pokemonApiClick${randomUUID().replaceAll('-', '')}`;
			await page.exposeBinding(binding, (source, input: unknown) => {
				const watch = [...this.watches.values()].find((item) => item.page === source.page);
				if (!watch || this.host.paused() || source.frame !== page.mainFrame() || !input || typeof input !== 'object') {
					return;
				}

				const event = input as {label?: unknown; at?: unknown};
				if (typeof event.label !== 'string' || typeof event.at !== 'number' || Math.abs(Date.now() - event.at) > 5000) {
					return;
				}

				watch.clicks.push({id: randomUUID(), label: visibleText(event.label).slice(0, 120), at: event.at});
				watch.clicks = watch.clicks.slice(-100);
			});
			this.observers.set(page, binding);
		}

		const install = (name: string) => {
			const root = window as unknown as Record<string, unknown>;
			if (root[`${name}Installed`]) {
				return;
			}

			root[`${name}Installed`] = true;
			document.addEventListener('click', (event) => {
				const target = event.target instanceof Element ? event.target.closest('button,a,[role="button"],[role="tab"],[role="option"]') : null;
				if (!event.isTrusted || !target || target.closest('form:has(input[type="password"])')) {
					return;
				}

				const send = root[name] as ((data: {label: string; at: number}) => Promise<unknown>) | undefined;
				void send?.({label: (target.getAttribute('aria-label') ?? target.textContent ?? target.tagName).trim().slice(0, 120), at: Date.now()}).catch(() => undefined);
			}, true);
		};

		await page.addInitScript(install, binding);
		await page.evaluate(install, binding);
	}
}
