import {z} from 'zod';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import {errorDetails, rejectedAction} from '../utils/errors.js';
import {identitySchema, type SavedConnection} from '../apps/connections.js';
import {callDiscoveredApi, discoverApi} from '../apps/local-api.js';
import {decryptCapture} from '../apps/capture.js';
import {untrusted} from '../utils/untrusted.js';

export const inspectSchema = z.object({
	action: z.literal('read'), window_id: z.string().regex(/^\d+$/), window_ref: z.string().regex(/^[a-f0-9]{32}$/),
	endpoint: z.string().max(1000).optional(), page_url: z.url().optional(),
	api_capture_file: z.string().max(1000).optional(), api_url_filter: z.string().min(1).max(500).optional(),
	app_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).optional(), api_operation: z.string().max(200).optional(),
	api_fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
	refresh: z.boolean().default(false), capture_fallback: z.boolean().default(true),
	query: z.string().max(200).default(''), max_elements: z.number().int().min(1).max(250).default(100),
	max_chars: z.number().int().min(1000).max(16000).default(8000),
}).strict();
export type InspectRequest = z.infer<typeof inspectSchema>;

const captureSchema = z.object({
	process_id: z.number().int().positive(), captured_at: z.number(),
	events: z.array(z.object({
		at: z.number(), url: z.url(), status: z.number(), body: z.string().max(16000).optional(),
	})).max(200),
});

/** Read only a bounded, recent, process-scoped capture. No credentials or request headers. */
export async function readApiCapture(path: string, processId: number, filter: string, maxChars: number) {
	const capture = captureSchema.parse(await decryptCapture(path));

	if (capture.process_id !== processId) {
		throw new Error('API capture belongs to a different application process.');
	}

	const now = Date.now();
	if (capture.captured_at > now + 5000 || now - capture.captured_at > 300000) {
		throw new Error('API capture is stale. Capture fresh traffic from this app.');
	}

	const events = capture.events.filter((event) => event.url.includes(filter) && event.at <= now + 5000 && now - event.at <= 300000);
	const latest = events.filter((event) => event.body?.trim()).at(-1);
	if (!latest) {
		throw new Error('No recent matching API response body was captured.');
	}

	if (latest.status < 200 || latest.status >= 300) {
		throw new Error(`Captured API response failed with HTTP ${latest.status}.`);
	}

	return {
		url: latest.url, status: latest.status, at: latest.at, text: latest.body!.slice(0, maxChars), truncated: latest.body!.length > maxChars,
		identity: 'operator-asserted, not process-attributed', source: 'api_capture', provenance: untrusted(new URL(latest.url).origin, 'operator-asserted proxy capture'),
	};
}

export async function inspectApp(runtime: PokemonRuntime, args: InspectRequest, signal?: AbortSignal) {
	let cacheHit = false;
	let
		rediscovered = args.refresh;
	let cacheError: string | undefined;
	const attempts: {method: string; available: boolean; reason?: string; duration_ms: number}[] = [];
	const check = () => {
		if (signal?.aborted || runtime.companion.state.paused) {
			throw rejectedAction(signal?.aborted ? 'CANCELLED' : 'PAUSED', 'App reading was cancelled or paused.');
		}
	};

	const request = async (action: string, text?: string) => {
		check();
		return runtime.windows.request(
			{
				action, text, window_id: args.window_id, window_ref: args.window_ref, query: args.query,
				max_elements: args.max_elements, max_chars: args.max_chars, max_depth: 24,
			},
			{
				signal, paused: () => runtime.companion.state.paused, timeoutMs: 5000, timeoutError: 'App observation timed out.',
			},
		);
	};

	const attempt = async <T>(method: string, run: () => Promise<T>) => {
		check();
		const start = performance.now();
		try {
			const data = await run();
			check();
			attempts.push({method, available: true, duration_ms: performance.now() - start});
			return data;
		} catch (error) {
			if (['PAUSED', 'CANCELLED', 'STALE_REF', 'WINDOW_NOT_FOUND', 'AMBIGUOUS_TARGET', 'API_OUTCOME_UNKNOWN', 'REPLAY_BLOCKED', 'APPROVAL_REQUIRED'].includes(errorDetails(error).code)) {
				throw error;
			}

			check();
			attempts.push({
				method, available: false, reason: error instanceof Error ? error.message : String(error), duration_ms: performance.now() - start,
			});
			return undefined;
		}
	};

	const identity = identitySchema.parse(await request('app_identity'));
	const appId = args.app_id ?? 'desktop';
	let saved: SavedConnection = {identity, updated_at: Date.now()};
	try {
		const known = await runtime.connections.get(appId, identity);
		if (known && !args.refresh && known.identity.version === identity.version) {
			saved = known;
		} else if (known) {
			rediscovered = true;
		}
	} catch (error) {
		cacheError = error instanceof Error ? error.message : String(error);
	}

	let endpoints: string[] | undefined;
	const discoverEndpoints = async () => {
		if (endpoints) {
			return endpoints;
		}

		const probe = await request('cdp_ports');
		endpoints = Array.isArray(probe.listeners)
			? (probe.listeners as {endpoint: string}[]).map((item) => item.endpoint)
			: (probe.ports as number[] ?? []).map((port) => `http://127.0.0.1:${port}`);
		return endpoints;
	};

	const owns = async (endpoint: string) => {
		if ((await request('endpoint_owner', endpoint)).owns !== true) {
			throw new Error('The saved endpoint is no longer owned by this application.');
		}
	};

	const persist = async () => {
		try {
			await runtime.connections.put(appId, identity, saved);
		} catch (error) {
			cacheError = error instanceof Error ? error.message : String(error);
		}
	};

	const forget = async (source: 'cdp' | 'api' | 'capture') => {
		saved[source] = undefined;
		rediscovered = true;
		try {
			await runtime.connections.invalidate(appId, identity, source);
		} catch (error) {
			cacheError = error instanceof Error ? error.message : String(error);
		}
	};

	const result = (method: string, data: unknown) => ({
		method, channel_used: method, provenance: untrusted(identity.image_path, method), attempts: attempts.map((item) => ({...item, reason_code: item.available ? 'AVAILABLE' : `${item.method.toUpperCase()}_UNAVAILABLE`})), data, cache_hit: cacheHit, rediscovered, ...(cacheError ? {cache_error: cacheError} : {}),
	});
	const readApi = async (definition: NonNullable<SavedConnection['api']>, fresh = false) => {
		const operation = args.api_operation;
		if (fresh && operation && !definition.operations.some((item) => item.id === operation)) {
			return {
				endpoint: definition.endpoint, operations: definition.operations.map((item) => ({id: item.id, path: item.path})),
				selection_required: true, requested_operation_unavailable: operation,
			};
		}

		return operation && args.api_fingerprint === definition.fingerprint
			? callDiscoveredApi(definition, operation, args.max_chars, signal, args.api_fingerprint, async (intent, refresh) => runtime.authorize(intent, refresh), async () => {
				await owns(definition.endpoint);
				return identitySchema.parse(await request('app_identity'));
			}, async (scope) => runtime.companion.revokeScope?.(scope), async (intent) => (await runtime.companion.approve?.({...intent, reconciliation: true}))?.authorized === true)
			: {
				endpoint: definition.endpoint, fingerprint: definition.fingerprint, operations: definition.operations.map((item) => ({id: item.id, path: item.path})), selection_required: true, execution_authority: process.env.POKEMON_AUTHORIZATION === 'host-client' ? 'host-authorized' : 'companion-enforced',
			};
	};

	// A previously verified API skips fresh CDP probes. Failure returns to full discovery.
	if (saved.api && !args.endpoint && (!saved.cdp || args.api_operation)) {
		const cached = await attempt('api', async () => {
			try {
				await owns(saved.api!.endpoint);
				const data = await readApi(saved.api!);
				cacheHit = true;
				return data;
			} catch (error) {
				check();
				await forget('api');
				throw error;
			}
		});
		if (cached) {
			return result('api', cached);
		}
	}

	const readCdp = async (endpoint: string, pageUrl?: string) => {
		check();
		const connected = await runtime.browser.connect(endpoint, async () => owns(endpoint));
		const candidates = pageUrl
			? connected.pages.filter((page) => {
				if (args.page_url) {
					return page.url === pageUrl;
				}

				const address = new URL(page.url);
				address.search = '';
				address.hash = '';
				return address.href === pageUrl;
			})
			: connected.pages;
		if (candidates.length !== 1) {
			throw rejectedAction('AMBIGUOUS_TARGET', 'CDP exposes multiple pages. Supply an exact page_url.');
		}

		const data = await runtime.browser.snapshot(candidates[0]!.page_id, args.query, args.max_elements, args.max_chars);
		if (!data.nodes.length && !data.text.text.trim()) {
			throw new Error('CDP has no matching content.');
		}

		return {...data, session_id: connected.session_id};
	};

	const dom = args.api_operation
		? undefined
		: await attempt('cdp', async () => {
			const failed = new Set<string>();
			if (saved.cdp && !args.endpoint) {
				try {
					await owns(saved.cdp.endpoint);
					const data = await readCdp(saved.cdp.endpoint, args.page_url ?? saved.cdp.page_url);
					cacheHit = true;
					return data;
				} catch (error) {
					check();
					failed.add(saved.cdp.endpoint);
					await forget('cdp');
					if (errorDetails(error).code === 'AMBIGUOUS_TARGET') {
						throw error;
					}
				}
			}

			const candidates = args.endpoint ? [args.endpoint] : await discoverEndpoints();
			for (const endpoint of candidates.filter((item) => !failed.has(item))) {
				check();
				try {
					if (args.endpoint) {
					// eslint-disable-next-line no-await-in-loop -- Explicit endpoints must also belong to the selected app.
						await owns(endpoint);
					}

					// eslint-disable-next-line no-await-in-loop -- Identify each owned endpoint once.
					const data = await readCdp(endpoint, args.page_url);
					const pageAddress = new URL(data.url);
					pageAddress.search = '';
					pageAddress.hash = '';
					saved.cdp = {endpoint, page_url: pageAddress.href};
					// eslint-disable-next-line no-await-in-loop -- Persist only a working connection.
					await persist();
					return data;
				} catch (error) {
					check();
					if (errorDetails(error).code === 'AMBIGUOUS_TARGET') {
						throw error;
					}
				}
			}

			throw new Error('No selected-application listener exposed usable CDP content.');
		});
	if (dom) {
		return result('cdp', dom);
	}

	const api = await attempt('api', async () => {
		if (saved.api) {
			try {
				await owns(saved.api.endpoint);
				const data = await readApi(saved.api);
				cacheHit = true;
				return data;
			} catch (error) {
				check();
				if (['API_OUTCOME_UNKNOWN', 'APPROVAL_REQUIRED', 'REPLAY_BLOCKED'].includes(errorDetails(error).code)) {
					throw error;
				}

				await forget('api');
			}
		}

		for (const endpoint of await discoverEndpoints()) {
			try {
				check();
				// eslint-disable-next-line no-await-in-loop -- Discover a local API only after CDP failed.
				const definition = await discoverApi(endpoint, signal);
				// eslint-disable-next-line no-await-in-loop -- Execute the selected read once on the new schema.
				const data = await readApi(definition, true);
				saved.api = definition;
				// eslint-disable-next-line no-await-in-loop -- Save verified API details.
				await persist();
				return data;
			} catch (error) {
				check();
				if (['API_OUTCOME_UNKNOWN', 'APPROVAL_REQUIRED', 'REPLAY_BLOCKED'].includes(errorDetails(error).code)) {
					throw error;
				}
			}
		}

		const path = args.api_capture_file ?? saved.capture?.file ?? process.env.POKEMON_API_CAPTURE_FILE;
		if (!path) {
			throw new Error('No local API schema or scoped decrypted API capture is available.');
		}

		let filter = args.api_url_filter ?? saved.capture?.filter ?? args.query;
		try {
			const data = await readApiCapture(path, identity.process_id, filter, args.max_chars);
			cacheHit = Boolean(saved.capture);
			saved.capture = {file: path, filter, url: data.url};
			await persist();
			return data;
		} catch (error) {
			if (!saved.capture || args.api_url_filter) {
				throw error;
			}

			await forget('capture');
			filter = args.query;
			const data = await readApiCapture(path, identity.process_id, filter, args.max_chars);
			saved.capture = {file: path, filter: new URL(data.url).pathname, url: data.url};
			await persist();
			return data;
		}
	});
	if (api) {
		return result('api', api);
	}

	const win32 = await attempt('win32', async () => {
		const data = await request('win32_text');
		if (data.available !== true) {
			throw new Error('No matching HWND child text is exposed through Win32.');
		}

		return data;
	});
	if (win32) {
		return result('win32', win32);
	}

	const uia = await attempt('uia', async () => {
		const data = await request('get_ui');
		if (!Array.isArray(data.nodes) || !data.nodes.length) {
			throw new Error('UIA exposed no matching controls.');
		}

		return data;
	});
	if (uia) {
		return result('uia', uia);
	}

	if (!args.capture_fallback) {
		return result('unavailable', undefined);
	}

	const capture = await attempt('screen_capture', async () => {
		await request('activate');
		await runtime.companion.capture(true);
		try {
			return await request('capture_window');
		} finally {
			await runtime.companion.capture(false);
		}
	});
	return result(capture ? 'screen_capture' : 'unavailable', capture);
}
