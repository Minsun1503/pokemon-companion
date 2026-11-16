import {randomUUID} from 'node:crypto';
import {join, resolve} from 'node:path';
import {homedir} from 'node:os';
import {
	chromium, type Browser, type BrowserContext, type Page, type ElementHandle, type Response,
} from 'playwright';
import {rejectedAction} from '../utils/errors.js';
import {bundledChromium} from './bundled.js';
import {lockProfile} from './profile.js';
import {untrusted} from '../utils/untrusted.js';
import {LocalJournal} from '../learning/privacy.js';
import {ActionJournal} from './actions.js';
import {approvalIntent, approvalRequired, type ApprovalIntent} from '../security/approval.js';
import {loopbackEndpoint} from '../utils/loopback.js';
import {readJson} from '../apps/local-api.js';
import {appProfiles} from '../apps/catalog.js';
export {loopbackEndpoint} from '../utils/loopback.js';

type Session = {context: BrowserContext; browser?: Browser; owned: boolean; endpoint?: string; validateOwner?: () => Promise<void>; release?: () => Promise<void>; profile?: string; headless?: boolean};
type Target = {page: Page; handle: ElementHandle<HTMLElement | SVGElement>; expires: number; name: string};
type Capture = {page: Page; listener: (response: Response) => void; events: Record<string, unknown>[]; dropped: number; started: number};
const semanticSelector = 'a,button,input:not([type=hidden]),textarea,select,[role],[contenteditable=true]';

/** One persistent context per runtime; attached applications are never closed by disconnect. */
export class BrowserAutomation {
	private readonly actions = new ActionJournal(new LocalJournal(process.env.POKEMON_ACTIONS_DIR || join(process.env.LOCALAPPDATA || homedir(), 'pokemon-companion', 'browser-actions')));
	private readonly sessions = new Map<string, Session>();
	private readonly pages = new Map<string, Page>();
	private readonly refs = new Map<string, Target>();
	private readonly captures = new Map<string, Capture>();
	private webSession: string | undefined;
	private readonly webPages = new Map<string, {page_id: string; url: string}>();
	private readonly contracts = new Map<string, {conversation: string; composer: string}>();
	constructor(private readonly authorize?: (intent: ApprovalIntent, refresh: () => Promise<ApprovalIntent>) => Promise<void>, private readonly revokeScope?: (scope: string) => Promise<void>, private readonly reconcileScope?: (intent: ApprovalIntent) => Promise<boolean>) {}

	setConversationContract(pageId: string, contract: {conversation: string; composer: string}) {
		this.contracts.set(pageId, contract);
	}

	async launch(channel: 'msedge' | 'chrome' | 'chromium' = 'chromium', headless = false, profile?: string) {
		const browserOptions = channel === 'chromium' ? {executablePath: bundledChromium()} : {channel};
		const directory = profile ?? join(process.env.LOCALAPPDATA || homedir(), 'pokemon-companion', 'browser', channel);
		const existing = [...this.sessions].find(([, session]) => session.profile === resolve(directory) && session.headless === headless);
		if (existing) {
			return {
				session_id: existing[0], page_id: this.remember(existing[1].context.pages()[0] ?? await existing[1].context.newPage()), profile: resolve(directory), owned: true,
			};
		}

		const lock = await lockProfile(directory);
		const context = await chromium.launchPersistentContext(lock.directory, {
			...browserOptions, headless,
			args: ['--force-renderer-accessibility', '--mute-audio'], viewport: null, timeout: 20000,
		}).catch(async (error: unknown) => {
			await lock.release();
			throw error;
		});
		const session_id = randomUUID();
		this.register(session_id, {
			context, owned: true, release: lock.release, profile: lock.directory, headless,
		});
		const page = context.pages()[0] ?? await context.newPage();
		return {
			session_id, page_id: this.remember(page), profile: directory, owned: true,
		};
	}

	async connect(endpoint: string, validateOwner?: () => Promise<void>) {
		const address = loopbackEndpoint(endpoint);
		if (!validateOwner) {
			throw rejectedAction('OWNER_PROOF_REQUIRED', 'Attaching CDP requires a selected window and a live loopback-only listener ownership check.');
		}

		await validateOwner();
		for (const [session_id, session] of this.sessions) {
			if (session.endpoint === address && session.browser?.isConnected()) {
				return {session_id, pages: this.tabs(session_id), owned: false};
			}
		}

		let transport = address;
		if (new URL(address).protocol === 'http:') {
			const version = (await readJson(new URL('/json/version', address).href, undefined, 65536)).value as {webSocketDebuggerUrl?: string};
			transport = loopbackEndpoint(version.webSocketDebuggerUrl ?? '');
			const source = new URL(address);
			const destination = new URL(transport);
			const normalizedHost = (host: string) => host === 'localhost' ? '127.0.0.1' : host;
			if (destination.protocol !== 'ws:' || destination.port !== source.port || normalizedHost(destination.hostname) !== normalizedHost(source.hostname)) {
				throw rejectedAction('OWNER_PROOF_REQUIRED', 'CDP websocket must use the same owned loopback listener.');
			}
		}

		await validateOwner();
		const browser = await chromium.connectOverCDP(transport, {timeout: 3000});
		try {
			await validateOwner();
		} catch (error) {
			await browser.close();
			throw error;
		}

		const context = browser.contexts()[0];
		if (!context) {
			await browser.close();
			throw rejectedAction('NO_CONTEXT', 'CDP did not expose a browser context.');
		}

		const session_id = randomUUID();
		this.register(session_id, {
			context, browser, owned: false, endpoint: address, validateOwner,
		});
		return {session_id, pages: this.tabs(session_id), owned: false};
	}

	async webPage(appId: string, url: string) {
		const address = new URL(url);
		if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password) {
			throw rejectedAction('INVALID_ARGS', 'Web apps require HTTP(S) URLs without credentials.');
		}

		let session = this.webSession ? this.sessions.get(this.webSession) : undefined;
		if (!session || session.context.pages().every((page) => page.isClosed())) {
			const opened = await this.launch('chromium', false, process.env.POKEMON_WEB_PROFILE);
			this.webSession = opened.session_id;
			session = this.sessions.get(opened.session_id)!;
		}

		const known = this.webPages.get(appId);
		let page = known ? this.pages.get(known.page_id) : undefined;
		if (!page || page.isClosed()) {
			page = session.context.pages().find((candidate) => {
				try {
					return new URL(candidate.url()).origin === address.origin;
				} catch {
					return false;
				}
			});
		}

		if (!page || page.isClosed()) {
			page = await session.context.newPage();
		}

		const pageId = this.remember(page);
		const profile = appProfiles[appId];
		if (profile) {
			this.setConversationContract(pageId, profile);
		}

		this.webPages.set(appId, {page_id: pageId, url: address.href});
		if (!known || known.url !== address.href || page.url() === 'about:blank' || new URL(page.url()).origin !== address.origin) {
			await this.navigate(pageId, address.href, Boolean(profile?.urls.some((allowed) => new URL(allowed).origin === address.origin)));
		}

		return {session_id: this.webSession!, page_id: pageId, page};
	}

	tabs(sessionId: string) {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw rejectedAction('STALE_REF', 'Unknown browser session. Launch or connect first.');
		}

		return session.context.pages().filter((page) => !page.isClosed()).map((page) => ({page_id: this.remember(page), url: page.url()}));
	}

	page(id: string): Page {
		const page = this.pages.get(id);
		if (!page || page.isClosed()) {
			throw rejectedAction('STALE_REF', 'Page is closed or unknown. Discover tabs again.');
		}

		return page;
	}

	remember(page: Page): string {
		for (const [id, known] of this.pages) {
			if (known === page) {
				return id;
			}
		}

		const id = randomUUID();
		this.pages.set(id, page);
		page.on('close', () => {
			this.pages.delete(id);
			this.networkStop(id);
		});
		page.setDefaultTimeout(10000);
		return id;
	}

	async snapshot(pageId: string, query = '', maxElements = 100, maxChars = 8000) {
		await this.validatePage(pageId);
		const page = this.page(pageId);
		await this.clearRefs(page);
		const all = await page.$$(semanticSelector);
		const handles = all.slice(0, 2000);
		const data = await page.evaluate(({elements, filter, limit}) => {
			const named = (element: Element) => {
				const html = element as HTMLElement;
				const input = element as HTMLInputElement;
				const ids = element.getAttribute('aria-labelledby')?.split(/\s+/) ?? [];
				return element.getAttribute('aria-label') || ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim()
					|| Array.from(input.labels ?? []).map((label) => label.textContent ?? '').join(' ').trim()
					|| element.getAttribute('placeholder') || html.innerText?.trim() || element.getAttribute('title') || '';
			};

			const matches = elements.map((element, index) => {
				const name = named(element);
				const style = getComputedStyle(element);
				const visible = element.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none';
				const tag = element.tagName.toLowerCase();
				return {
					index, name: name.slice(0, 300), name_clipped: name.length > 300, tag,
					role: element.getAttribute('role') || ({
						a: 'link', button: 'button', input: 'textbox', textarea: 'textbox', select: 'combobox',
					} as Record<string, string>)[tag] || tag,
					id: element.id, value: ['input', 'textarea', 'select'].includes(tag) ? (element as HTMLInputElement).value.slice(0, 500) : (element as HTMLElement).isContentEditable ? (element as HTMLElement).innerText.slice(0, 500) : undefined,
					disabled: element.matches(':disabled,[aria-disabled=true]'), visible,
					href: tag === 'a' ? element.getAttribute('href') : undefined,
				};
			}).filter((item) => item.visible && (!filter || (`${item.name} ${item.id} ${item.role}`).toLowerCase().includes(filter.toLowerCase())));
			return {nodes: matches.slice(0, limit), matched: matches.length, truncated: matches.length > limit};
		}, {elements: handles, filter: query, limit: maxElements});
		const keep = new Set<number>();
		const nodes = data.nodes.map((node) => {
			const ref = randomUUID();
			keep.add(node.index);
			this.refs.set(ref, {
				page, handle: handles[node.index]!, expires: Date.now() + 120000, name: node.name,
			});
			return {
				ref, name: node.name, name_clipped: node.name_clipped, tag: node.tag, role: node.role,
				id: node.id, value: node.value, disabled: node.disabled, href: node.href,
			};
		});
		await Promise.all(all.filter((_handle, index) => !keep.has(index)).map(async (handle) => handle.dispose()));
		return {
			page_id: pageId, provenance: untrusted(new URL(page.url()).origin, 'playwright'), url: page.url(), title: await page.title(), nodes, matched: data.matched,
			truncated: data.truncated || all.length > 2000, text: await this.text(pageId, maxChars),
		};
	}

	async text(pageId: string, maxChars = 8000) {
		await this.validatePage(pageId);
		const result = await this.page(pageId).locator('body').evaluate((element, limit) => {
			const text = (element as HTMLElement).innerText;
			return {text: text.slice(0, limit), truncated: text.length > limit};
		}, maxChars);
		return {...result, provenance: untrusted(new URL(this.page(pageId).url()).origin, 'playwright')};
	}

	async validatePage(pageId: string) {
		const page = this.page(pageId);
		const session = [...this.sessions.values()].find((candidate) => candidate.context === page.context());
		if (session) {
			await session.validateOwner?.();
			return;
		}

		throw rejectedAction('STALE_REF', 'Page session was disconnected.');
	}

	async navigate(pageId: string, url: string, catalogOrigin = false) {
		await this.validatePage(pageId);
		const page = this.page(pageId);
		const destination = new URL(url);
		const {origin} = new URL(page.url());
		const configured = (process.env.POKEMON_BROWSER_ORIGINS ?? '').split(',').filter(Boolean);
		if (!catalogOrigin && destination.origin !== origin && !configured.includes(destination.origin)) {
			const refresh = async () => {
				await this.validatePage(pageId);
				return approvalIntent('browser', 'navigate', destination.href, destination.href, '', page.url(), {page_id: pageId, from: page.url(), to: destination.href});
			};

			const intent = await refresh();
			if (process.env.POKEMON_AUTHORIZATION !== 'host-client') {
				if (!this.authorize) {
					throw approvalRequired(intent.action_id);
				}

				await this.authorize(intent, refresh);
			}
		}

		await page.goto(destination.href, {waitUntil: 'domcontentloaded', timeout: 20000});
		return {url: page.url(), title: await page.title()};
	}

	async target(pageId: string, ref: string) {
		await this.validatePage(pageId);
		const target = this.refs.get(ref);
		if (target?.page !== this.page(pageId) || target.expires < Date.now() || !await target.handle.evaluate((element) => element.isConnected)) {
			throw rejectedAction('STALE_REF', 'Element reference is stale. Take a fresh DOM snapshot; never replay uncertain input.');
		}

		return target.handle;
	}

	async input(pageId: string, ref: string, action: 'fill' | 'click' | 'press', value = '', actionId?: string) {
		const target = await this.target(pageId, ref);
		const contract = this.contracts.get(pageId) ?? {conversation: '', composer: ''};
		const refresh = async () => {
			await this.validatePage(pageId);
			const state = await target.evaluate((element, selectors) => {
				const identity = {
					tag: element.tagName, id: element.id, name: element.getAttribute('name'), role: element.getAttribute('role'),
				};
				const headers = selectors.conversation ? document.querySelectorAll(selectors.conversation) : [];
				const header = headers.length === 1 ? headers[0] : undefined;
				const conversation = header ? {id: header.getAttribute('data-conversation-id') ?? header.getAttribute('data-thread-id') ?? '', title: (header.textContent ?? '').trim()} : null;
				const composer = selectors.composer ? document.querySelector(selectors.composer) : null;
				const region = composer ?? element.closest('form') ?? document.body;
				const candidates = [...(region.matches('input,textarea,[contenteditable=true]') ? [region] : []), ...Array.from(region.querySelectorAll('input:not([type=password]):not([type=hidden]),textarea,[contenteditable=true]'))];
				const fields = candidates.filter((field) => field.getClientRects().length > 0).map((field) => (field as HTMLInputElement).value ?? field.textContent ?? '');
				const label = element.getAttribute('aria-label') ?? (element.matches('[contenteditable=true],input,textarea') ? element.getAttribute('name') ?? 'Text input' : element.textContent ?? element.tagName);
				return {
					identity, label, fields, conversation, inComposer: Boolean(composer?.contains(element)),
				};
			}, contract);
			const page = this.page(pageId);
			const binding = {identity: state.identity, conversation: state.conversation, page: new URL(page.url()).origin + new URL(page.url()).pathname};
			return approvalIntent('browser', action === 'press' ? `press:${value}` : action, `${state.identity.role ?? state.identity.tag}: ${state.label}`, page.url(), value, state, binding, {
				input: action === 'fill' ? value : state.fields.filter(Boolean).join('\n'), conversation: state.conversation?.title ?? '', scopeAllowed: Boolean(state.conversation?.id && state.conversation.title && state.inComposer), operationClass: action === 'fill' ? 'draft' : 'commit', scope: {page: binding.page, conversation: state.conversation, ...(action === 'fill' ? {identity: state.identity} : {})},
			});
		};

		const intent = await refresh();
		if (await this.actions.blocked(intent.scope_hash)) {
			await this.revokeScope?.(intent.scope_hash);
			if (await this.reconcileScope?.(intent)) {
				await this.actions.reconcile(intent.scope_hash);
				throw rejectedAction('RECONCILED', 'Outcome reviewed through the companion. Read the target again and request a new approval. No input was sent.');
			}

			throw rejectedAction('REPLAY_BLOCKED', 'This scope has an unknown outcome. Review the companion reconciliation dialog. No input was sent.');
		}

		if (process.env.POKEMON_BROWSER_INPUT !== 'host-authorized' && process.env.POKEMON_AUTHORIZATION !== 'host-client') {
			if (!this.authorize) {
				throw approvalRequired(intent.action_id);
			}

			await this.authorize(intent, refresh);
		}

		try {
			const outcome = await this.actions.run(intent.digest, async () => {
				if ((await refresh()).digest !== intent.digest) {
					throw rejectedAction('APPROVAL_STATE_CHANGED', 'Page state changed before dispatch. No input was sent.');
				}

				if (action === 'fill') {
					await target.fill(value);
					return {
						value: await target.evaluate((element) => {
							const html = element as HTMLElement;
							return html.isContentEditable ? html.innerText : (element as HTMLInputElement).value;
						}),
					};
				}

				if (action === 'click') {
					await target.click();
				} else {
					await target.press(value);
				}

				return {dispatched: true};
			}, (result) => action === 'fill' && 'value' in result && result.value === value, actionId ?? intent.action_id, intent.scope_hash);
			if (outcome.outcome === 'unknown') {
				await this.revokeScope?.(intent.scope_hash);
			}

			return outcome;
		} catch (error) {
			if (await this.actions.blocked(intent.scope_hash)) {
				await this.revokeScope?.(intent.scope_hash);
			}

			throw error;
		}
	}

	networkStart(pageId: string, urlFilter: string) {
		if (!urlFilter) {
			throw rejectedAction('INVALID_ARGS', 'A URL substring filter is required to scope network capture.');
		}

		this.networkStop(pageId);
		const page = this.page(pageId);
		const capture: Capture = {
			page, events: [], dropped: 0, started: Date.now(), listener: () => undefined,
		};
		capture.listener = (response) => {
			if (!response.url().includes(urlFilter) || !['xhr', 'fetch'].includes(response.request().resourceType())) {
				return;
			}

			const url = new URL(response.url());
			if (capture.events.length === 200) {
				capture.events.shift();
				capture.dropped += 1;
			}

			capture.events.push({
				at: Date.now(), url: url.origin + url.pathname, method: response.request().method(), status: response.status(), type: response.request().resourceType(),
			});
		};

		page.on('response', capture.listener);
		this.captures.set(pageId, capture);
		return {
			capturing: true, url_filter: urlFilter, headers_and_bodies: 'excluded', max_events: 200,
		};
	}

	networkRead(pageId: string) {
		const capture = this.captures.get(pageId);
		if (!capture) {
			return {events: [], capturing: false};
		}

		return {
			events: [...capture.events], dropped: capture.dropped, started: capture.started, capturing: true,
		};
	}

	networkStop(pageId: string) {
		const capture = this.captures.get(pageId);
		if (capture) {
			capture.page.off('response', capture.listener);
		}

		this.captures.delete(pageId);
		return {capturing: false};
	}

	async clearRefs(page: Page) {
		const dispose: Promise<void>[] = [];
		for (const [id, ref] of this.refs) {
			if (ref.page === page || ref.expires < Date.now()) {
				this.refs.delete(id);
				dispose.push(ref.handle.dispose().catch(() => undefined));
			}
		}

		await Promise.all(dispose);
	}

	async close(sessionId?: string) {
		for (const [id, session] of this.sessions) {
			if (sessionId && id !== sessionId) {
				continue;
			}

			for (const [pageId, page] of this.pages) {
				if (page.context() === session.context) {
					this.networkStop(pageId);
					// eslint-disable-next-line no-await-in-loop -- Release handles before disconnecting this session.
					await this.clearRefs(page);
					this.pages.delete(pageId);
				}
			}

			this.sessions.delete(id);
			if (this.webSession === id) {
				this.webSession = undefined;
				this.webPages.clear();
			}

			if (session.owned) {
				// eslint-disable-next-line no-await-in-loop -- Close owned sessions sequentially during teardown.
				await session.context.close();
				// eslint-disable-next-line no-await-in-loop -- Release each owned profile after its context is closed.
				await session.release?.();
			} else {
				// eslint-disable-next-line no-await-in-loop -- Disconnect without closing attached application pages.
				await session.browser?.close();
			} // connectOverCDP close disconnects; it does not terminate the app.
		}

		if (!sessionId) {
			await this.actions.close();
		}
	}

	private register(sessionId: string, session: Session) {
		this.sessions.set(sessionId, session);
		const cleanup = () => {
			void session.release?.();
			if (this.sessions.get(sessionId) !== session) {
				return;
			}

			this.sessions.delete(sessionId);
			if (this.webSession === sessionId) {
				this.webSession = undefined;
			}

			for (const [pageId, page] of this.pages) {
				if (page.context() === session.context) {
					this.networkStop(pageId);
					void this.clearRefs(page);
					this.pages.delete(pageId);
				}
			}

			for (const [appId, known] of this.webPages) {
				if (!this.pages.has(known.page_id)) {
					this.webPages.delete(appId);
				}
			}
		};

		session.context.once('close', cleanup);
		session.browser?.once('disconnected', cleanup);
	}
}
