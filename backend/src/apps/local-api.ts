import {createHash} from 'node:crypto';
import {loopbackEndpoint} from '../utils/loopback.js';
import {DesktopError, rejectedAction} from '../utils/errors.js';
import type {SavedConnection} from './connections.js';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {LocalJournal} from '../learning/privacy.js';
import {ActionJournal} from '../browser/actions.js';
import {approvalIntent, approvalRequired, type ApprovalIntent} from '../security/approval.js';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
const unsafeGet = /(?:delete|remove|logout|signout|send|execute|shutdown|restart|reset|clear)/i;

function responseSchema(spec: JsonObject, schema: JsonObject | undefined) {
	if (typeof schema?.$ref !== 'string' || !schema.$ref.startsWith('#/')) {
		return schema;
	}

	let resolved: unknown = spec;
	for (const part of schema.$ref.slice(2).split('/')) {
		resolved = object(resolved)?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
	}

	return object(resolved);
}

/** Bounded same-origin reads; redirects do not become a route to another application. */
export async function readJson(url: string, signal?: AbortSignal, limit = 1024 * 1024) {
	loopbackEndpoint(url);
	const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(2000)]) : AbortSignal.timeout(2000);
	const response = await fetch(url, {signal: combined, redirect: 'error', headers: {accept: 'application/json'}});
	if (!response.ok) {
		throw new Error(`API read returned HTTP ${response.status}.`);
	}

	if (Number(response.headers.get('content-length')) > limit) {
		throw new Error('API response exceeds the read limit.');
	}

	if (!response.body) {
		throw new Error('API returned no response body.');
	}

	const reader = response.body.getReader();
	let bytes = 0;
	const chunks: Uint8Array[] = [];
	try {
		for (;;) {
			// eslint-disable-next-line no-await-in-loop -- Stream a bounded response.
			const {done, value} = await reader.read();
			if (done) {
				break;
			}

			bytes += value.length;
			if (bytes > limit) {
				throw new Error('API response exceeds the read limit.');
			}

			chunks.push(value);
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}

	const text = Buffer.concat(chunks).toString('utf8');
	return {value: JSON.parse(text) as unknown, text, status: response.status};
}

export async function discoverApi(endpoint: string, signal?: AbortSignal): Promise<NonNullable<SavedConnection['api']>> {
	const {origin} = new URL(loopbackEndpoint(endpoint));
	for (const path of ['/openapi.json', '/swagger.json', '/swagger/v1/swagger.json']) {
		try {
			// eslint-disable-next-line no-await-in-loop -- Probe documented schemas in deterministic order.
			const {value, text} = await readJson(origin + path, signal);
			const spec = object(value);
			const
				paths = object(spec?.paths);
			if (!spec || !paths || (!spec.openapi && !spec.swagger)) {
				throw new Error('Not an OpenAPI document.');
			}

			const operations: NonNullable<SavedConnection['api']>['operations'] = [];
			for (const [apiPath, definition] of Object.entries(paths)) {
				const operation = object(object(definition)?.get);
				if (!operation || !apiPath.startsWith('/') || apiPath.startsWith('//') || /[{}?#]/.test(apiPath) || unsafeGet.test(apiPath)) {
					continue;
				}

				const parameters = [...(Array.isArray(object(definition)?.parameters) ? object(definition)!.parameters as unknown[] : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])];
				const security = operation.security ?? spec.security;
				if (parameters.some((parameter) => object(parameter)?.required === true) || (Array.isArray(security) && security.length)) {
					continue;
				}

				const response = object(object(operation.responses)?.['200']);
				const schema = responseSchema(spec, object(object(object(response?.content)?.['application/json'])?.schema) ?? object(response?.schema));

				const structural = schema ? {type: schema.type, required: schema.required} : undefined;
				operations.push({id: typeof operation.operationId === 'string' ? operation.operationId : apiPath, path: apiPath, response_schema: structural});
				if (operations.length === 200) {
					break;
				}
			}

			if (!operations.length) {
				throw new Error('No parameter-free public GET operations are described.');
			}

			return {
				endpoint: origin, spec_path: path, fingerprint: createHash('sha256').update(text).digest('hex'), operations,
			};
		} catch (error) {
			if (signal?.aborted) {
				throw error;
			}
		}
	}

	throw new Error('No usable local API schema was found.');
}

export async function callDiscoveredApi(api: NonNullable<SavedConnection['api']>, operationId: string, maxChars: number, signal?: AbortSignal, expectedFingerprint?: string, authorize?: (intent: ApprovalIntent, refresh: () => Promise<ApprovalIntent>) => Promise<void>, owner?: () => Promise<unknown>, revoke?: (scope: string) => Promise<void>, reconcile?: (intent: ApprovalIntent) => Promise<boolean>) {
	if (!expectedFingerprint || expectedFingerprint !== api.fingerprint) {
		throw rejectedAction('API_SELECTION_REQUIRED', 'Select an operation and its current spec fingerprint from the catalog. Discovery never executes operations.');
	}

	const specUrl = new URL(api.spec_path, api.endpoint);
	if (specUrl.origin !== new URL(api.endpoint).origin) {
		throw rejectedAction('INVALID_ARGS', 'API schema must stay on the selected app origin.');
	}

	const current = await readJson(specUrl.href, signal);
	if (createHash('sha256').update(current.text).digest('hex') !== expectedFingerprint) {
		throw rejectedAction('API_SPEC_CHANGED', 'API schema changed. Rediscover and review the new catalog before execution. No operation was sent.');
	}

	const operation = api.operations.find((item) => item.id === operationId);
	if (!operation) {
		throw rejectedAction('API_OPERATION_NOT_FOUND', 'The saved API operation is no longer available. Rediscover the API.');
	}

	const url = new URL(operation.path, api.endpoint);
	if (url.origin !== new URL(api.endpoint).origin || unsafeGet.test(url.pathname)) {
		throw rejectedAction('INVALID_ARGS', 'Discovered GET must stay on the selected app origin.');
	}

	const refresh = async () => {
		const ownerIdentity = await owner?.();
		const spec = await readJson(specUrl.href, signal);
		const fingerprint = createHash('sha256').update(spec.text).digest('hex');
		if (fingerprint !== expectedFingerprint) {
			throw rejectedAction('API_SPEC_CHANGED', 'Schema changed before dispatch. Review the new catalog.');
		}

		return approvalIntent('app', 'api_get', `${operationId}: ${operation.path}`, url.href, '', {fingerprint, owner: ownerIdentity}, {fingerprint, owner: ownerIdentity, operation: operation.path});
	};

	const intent = await refresh();
	const journal = new ActionJournal(new LocalJournal(join(process.env.POKEMON_ACTIONS_DIR || join(process.env.LOCALAPPDATA || homedir(), 'pokemon-companion'), 'api-actions')));
	if (await journal.blocked(intent.scope_hash)) {
		try {
			await revoke?.(intent.scope_hash);
			if (await reconcile?.(intent)) {
				await journal.reconcile(intent.scope_hash);
				throw rejectedAction('RECONCILED', 'API outcome reviewed. Rediscover and request new approval. No operation was sent.');
			}

			throw rejectedAction('REPLAY_BLOCKED', 'API scope has an unknown outcome. Review the companion reconciliation dialog.');
		} finally {
			await journal.close();
		}
	}

	if (process.env.POKEMON_API_EXECUTION !== 'host-authorized' && process.env.POKEMON_AUTHORIZATION !== 'host-client') {
		if (!authorize) {
			await journal.close();
			throw approvalRequired(intent.action_id);
		}

		try {
			await authorize(intent, refresh);
		} catch (error) {
			await journal.close();
			throw error;
		}
	}

	let response;
	try {
		response = (await journal.run(intent.digest, async () => {
			if ((await refresh()).digest !== intent.digest) {
				throw rejectedAction('APPROVAL_STATE_CHANGED', 'API owner or schema changed before dispatch.');
			}

			const data = await readJson(url.href, signal, 256 * 1024);
			const schema = operation.response_schema;
			const type = Array.isArray(data.value) ? 'array' : data.value === null ? 'null' : typeof data.value;
			if (schema?.type && schema.type !== type && !(schema.type === 'integer' && typeof data.value === 'number' && Number.isInteger(data.value))) {
				throw new Error('API response type changed after dispatch.');
			}

			if (Array.isArray(schema?.required) && schema.required.some((key) => typeof key === 'string' && !Object.hasOwn(object(data.value) ?? {}, key))) {
				throw new Error('API response schema changed after dispatch.');
			}

			return data;
		}, () => true, intent.action_id, intent.scope_hash)).result;
	} catch (error) {
		if (await journal.blocked(intent.scope_hash)) {
			await revoke?.(intent.scope_hash);
		}

		if (error instanceof DesktopError && error.details.code === 'REPLAY_BLOCKED') {
			throw error;
		}

		throw new DesktopError('API request outcome is unknown. Read state before any retry; no automatic replay.', {code: 'API_OUTCOME_UNKNOWN', disposition: {delivery: 'delivery_uncertain', retry: 'unsafe'}});
	} finally {
		await journal.close();
	}

	const {text, status} = response;

	return {
		url: url.href, operation_id: operationId, status, text: text.slice(0, maxChars), truncated: text.length > maxChars,
	};
}
