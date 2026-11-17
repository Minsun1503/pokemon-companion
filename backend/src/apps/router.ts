import {z} from 'zod';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import {errorDetails, rejectedAction} from '../utils/errors.js';
import {inspectApp, inspectSchema} from '../desktop/inspect.js';
import {appProfiles} from './catalog.js';
import {observeAppState, type AppState} from './state.js';
import {untrusted} from '../utils/untrusted.js';

export const appSchema = z.object({
	action: z.enum(['read', 'api_get']), app_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
	web_urls: z.array(z.url()).min(1).max(4).optional(), web_ready_selector: z.string().min(1).max(1000).optional(),
	web_unavailable_selector: z.string().max(1000).optional(), desktop_query: z.string().min(1).max(200).optional(),
	web_auth_selector: z.string().max(1000).optional(), web_error_selector: z.string().max(1000).optional(),
	desktop_launch: z.string().max(1000).optional(), window_id: z.string().regex(/^\d+$/).optional(),
	window_ref: z.string().regex(/^[a-f0-9]{32}$/).optional(), endpoint: z.string().max(1000).optional(), page_url: z.url().optional(),
	api_operation: z.string().max(200).optional(), api_capture_file: z.string().max(1000).optional(), api_url_filter: z.string().max(500).optional(),
	api_fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
	refresh: z.boolean().default(false), capture_fallback: z.boolean().default(true),
	query: z.string().max(200).default(''), timeout_ms: z.number().int().min(100).max(15000).default(5000),
	max_elements: z.number().int().min(1).max(250).default(100), max_chars: z.number().int().min(1000).max(16000).default(8000),
}).strict();
export type AppRequest = z.infer<typeof appSchema>;
const reads = new WeakMap<PokemonRuntime, Map<string, number>>();

export async function routeApp(runtime: PokemonRuntime, args: AppRequest, signal?: AbortSignal) {
	const check = () => {
		if (signal?.aborted || runtime.companion.state.paused) {
			throw rejectedAction(signal?.aborted ? 'CANCELLED' : 'PAUSED', 'Application access was cancelled or paused.');
		}
	};

	const profile = appProfiles[args.app_id];
	if (profile && args.web_urls?.some((url) => !profile.urls.some((allowed) => new URL(allowed).origin === new URL(url).origin))) {
		throw rejectedAction('INVALID_ARGS', 'Catalog applications are pinned to their configured origins.');
	}

	check();
	if (args.action === 'read') {
		const recent = reads.get(runtime) ?? new Map<string, number>();
		const previous = recent.get(args.app_id);
		if (previous !== undefined && Date.now() - previous < 1000) {
			throw rejectedAction('RATE_LIMITED', 'Application reads are limited to one per second per app.');
		}

		recent.set(args.app_id, Date.now());
		reads.set(runtime, recent);
	}

	const urls = args.web_urls ?? profile?.urls;
	const ready = args.web_ready_selector ?? profile?.ready;
	const unavailable = args.web_unavailable_selector ?? profile?.unavailable;
	if (args.action === 'read' && (!urls || !ready)) {
		throw rejectedAction('INVALID_ARGS', 'A custom application requires web_urls and web_ready_selector.');
	}

	if (args.action === 'api_get' && !args.api_operation) {
		throw rejectedAction('INVALID_ARGS', 'api_get requires a discovered api_operation ID.');
	}

	const webAttempts: {url: string; available: boolean; state: AppState; reason_code: string; reason?: string; duration_ms: number}[] = [];
	if (args.action === 'read') {
		for (const url of urls!) {
			check();
			const start = performance.now();
			try {
			// eslint-disable-next-line no-await-in-loop -- Try the app's preferred web URLs before any desktop source.
				const opened = await runtime.browser.webPage(args.app_id, url);
				const contract = {
					ready: ready!, auth: args.web_auth_selector ?? unavailable ?? '', unavailable: args.web_error_selector ?? '', origin: new URL(url).origin,
				};
				// eslint-disable-next-line no-await-in-loop -- Wait for app-specific authenticated UI, not merely HTTP success.
				await opened.page.waitForFunction(({ready, auth, unavailable, origin}) => {
					const visible = (selector: string) => Boolean(selector) && Array.from(document.querySelectorAll(selector)).some((element) => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
					return location.origin !== origin || visible(auth) || visible(unavailable) || visible(ready);
				}, contract, {timeout: args.timeout_ms}).catch((error: unknown) => {
					if (!(error instanceof Error) || error.name !== 'TimeoutError') {
						throw error;
					}
				});
				// eslint-disable-next-line no-await-in-loop -- Confirm availability after readiness wait.
				const state = await opened.page.evaluate(observeAppState, contract);
				check();
				if (state !== 'ready') {
					webAttempts.push({
						url, available: false, state, reason_code: state.toUpperCase(), duration_ms: performance.now() - start,
					});
					if (state === 'layout_changed') {
						return {
							app_id: args.app_id, state, surface: 'unavailable', method: 'unavailable', channel_used: 'playwright', web_attempts: webAttempts, diagnostics: {url: opened.page.url(), contract}, provenance: untrusted(new URL(url).origin, 'playwright'),
						};
					}

					continue;
				}

				// eslint-disable-next-line no-await-in-loop -- Read the verified web surface.
				const data = await runtime.browser.snapshot(opened.page_id, args.query, args.max_elements, args.max_chars);
				webAttempts.push({
					url, available: true, state: 'ready', reason_code: 'READY', duration_ms: performance.now() - start,
				});
				return {
					app_id: args.app_id, state: 'ready', surface: 'web', method: 'playwright', channel_used: 'playwright', web_attempts: webAttempts, data: {...data, session_id: opened.session_id}, provenance: untrusted(new URL(url).origin, 'playwright'),
				};
			} catch (error) {
				check();
				if (errorDetails(error).code === 'INVALID_ARGS') {
					throw error;
				}

				webAttempts.push({
					url, available: false, state: 'unavailable', reason_code: 'WEB_ACCESS_FAILED', reason: error instanceof Error ? error.message : String(error), duration_ms: performance.now() - start,
				});
			}
		}
	}

	check();
	if (process.platform !== 'win32') {
		throw rejectedAction('ACTION_NOT_SUPPORTED', 'Desktop app fallback currently requires Windows.');
	}

	const request = async (action: string, query?: string, text?: string) => runtime.windows.request(
		{
			action, query, text, max_elements: 100, max_chars: 16000,
		},
		{
			signal, paused: () => runtime.companion.state.paused, timeoutMs: 5000, timeoutError: 'Desktop app discovery timed out.',
		},
	);
	let windowId = args.window_id;
	let
		windowRef = args.window_ref;
	if (!windowId || !windowRef) {
		const query = args.desktop_query ?? profile?.desktop_query;
		if (!query) {
			throw rejectedAction('INVALID_ARGS', 'A custom app requires desktop_query or an observed window_id/window_ref.');
		}

		let listed = await request('get_windows', query);
		const launch = args.desktop_launch ?? profile?.launch;
		if (Array.isArray(listed.windows) && !listed.windows.length && launch) {
			try {
				await request('launch', undefined, launch);
			} catch {
				check();
			}

			listed = await request('get_windows', query);
		}

		const windows = listed.windows as {id: string; window_ref: string}[];
		if (!listed.complete || listed.truncated || !Array.isArray(windows) || windows.length !== 1) {
			if (windows?.length > 1) {
				throw rejectedAction('AMBIGUOUS_TARGET', 'Multiple desktop windows match. Supply the exact observed window ID and token.');
			}

			return {
				app_id: args.app_id, state: webAttempts.some((attempt) => attempt.state === 'auth_required') ? 'auth_required' : 'unavailable', surface: 'unavailable', method: 'unavailable', channel_used: 'unavailable', web_attempts: webAttempts, reason: 'No running desktop app matches the selected application.',
			};
		}

		windowId = windows[0]!.id;
		windowRef = windows[0]!.window_ref;
	}

	check();
	const desktopArgs = Object.fromEntries(Object.entries(args).filter(([key]) => Object.hasOwn(inspectSchema.shape, key)));
	const result = await inspectApp(runtime, inspectSchema.parse({
		...desktopArgs, action: 'read', window_id: windowId, window_ref: windowRef,
	}), signal);
	return {
		app_id: args.app_id, surface: 'desktop', web_attempts: webAttempts, ...result,
	};
}
