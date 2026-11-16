import {createHash} from 'node:crypto';
import {type BrowserContext} from 'playwright';
import {type CapturedOperation} from './api-store.js';
import {visibleText} from '../security/approval.js';
import {rejectedAction} from '../utils/errors.js';

export const secretField = /(?:authorization|cookie|password|passwd|token|secret|canary|csrf|xsrf|credential|api[-_]?key)/i;
const transportHeader = /^(?:cookie|set-cookie|host|content-length|connection|accept-encoding|user-agent|sec-|:)/i;
export function endpoint(url: string) {
	const address = new URL(url);
	return address.origin + address.pathname.split('/').map((part) => part.length > 80 ? '[opaque]' : part).join('/');
}

export function redact(value: unknown, depth = 0, secrets: string[] = []): unknown {
	if (depth > 12) {
		return '[depth limit]';
	}

	if (Array.isArray(value)) {
		return value.map((item) => redact(item, depth + 1, secrets));
	}

	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [mask(key, secrets), secretField.test(key) && !['cookie_names', 'cookie_values'].includes(key) ? '[protected]' : redact(item, depth + 1, secrets)]));
	}

	return typeof value === 'string' ? mask(value, secrets) : value;
}

function mask(value: string, secrets: string[]) {
	let result = value.replace(/Bearer\s+\S+/gi, '[protected]');
	for (const secret of secrets) {
		if (secret.length >= 4) {
			result = result.replaceAll(secret, '[protected]');
		} else if (result === secret) {
			result = '[protected]';
		}
	}

	return result;
}

/** Returns only a redaction closure; raw cookies never leave this helper. */
export async function protector(context: BrowserContext, origin: string, rows: CapturedOperation[]) {
	const secrets = new Set<string>();
	const add = (value: unknown) => {
		if (typeof value === 'string' && value) {
			secrets.add(value);
			const bearer = /^Bearer\s+(.+)$/i.exec(value);
			if (bearer?.[1]) {
				secrets.add(bearer[1]);
			}
		}
	};

	const collect = (value: unknown, depth = 0) => {
		if (!value || typeof value !== 'object' || depth > 12) {
			return;
		}

		for (const [key, item] of Object.entries(value)) {
			if (secretField.test(key)) {
				add(item);
			} else {
				collect(item, depth + 1);
			}
		}
	};

	(await context.cookies()).forEach((cookie) => {
		add(cookie.value);
	});
	for (const row of rows.filter((row) => row.origin === origin)) {
		collect(row.headers);
		collect(Object.fromEntries(new URL(row.url).searchParams));
		collect(requestBody(row.body, row.headers['content-type'] ?? '').value);
	}

	const values = [...secrets].sort((a, b) => b.length - a.length);
	return <T>(value: T): T => redact(value, 0, values) as T;
}

export function requestBody(body: string | null, contentType: string) {
	if (body === null) {
		return {type: 'none' as const, value: null};
	}

	try {
		if (contentType.includes('json')) {
			return {type: 'json' as const, value: JSON.parse(body) as unknown};
		}

		if (contentType.includes('application/x-www-form-urlencoded')) {
			return {type: 'form' as const, value: Object.fromEntries(new URLSearchParams(body))};
		}
	} catch {
		// Unsupported or malformed payloads remain catalog entries, never replay templates.
	}

	return {type: 'unsupported' as const, value: null};
}

export function replayHeaders(headers: Record<string, string>) {
	return Object.fromEntries(Object.entries(headers).filter(([key]) => !transportHeader.test(key)));
}

export async function cookieIdentity(context: BrowserContext, origin: string) {
	const {hostname} = new URL(origin);
	const cookies = (await context.cookies()).filter((cookie) => {
		const domain = cookie.domain.replace(/^\./, '');
		return hostname === domain || hostname.endsWith(`.${domain}`);
	});
	const rows = cookies.map((cookie) => [cookie.domain, cookie.path, cookie.name, cookie.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
	return {hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex'), names: cookies.map((cookie) => cookie.name).sort()};
}

function fields(value: unknown): unknown {
	if (Array.isArray(value)) {
		return ['array', value.length ? fields(value[0]) : null];
	}

	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, fields(item)]));
	}

	return typeof value;
}

export function operationSignature(profile: string, url: string, method: string, headers: Record<string, string>, body: string | null) {
	const address = new URL(url);
	const data = requestBody(body, headers['content-type'] ?? '');
	const object = data.value && typeof data.value === 'object' && !Array.isArray(data.value) ? data.value as Record<string, unknown> : {};
	const labelValue = headers['x-owa-action'] ?? object.operationName ?? object.fb_api_req_friendly_name ?? address.searchParams.get('action');
	const label = typeof labelValue === 'string' && /^[\w.:-]{1,120}$/.test(labelValue) ? labelValue : '';
	const signature = createHash('sha256').update(JSON.stringify({
		profile, endpoint: address.origin + address.pathname, method,
		query_keys: [...address.searchParams.keys()].sort(), label, fields: fields(data.value),
	})).digest('hex');
	return {signature, label, body_type: data.type};
}

export function summary(row: CapturedOperation) {
	const address = new URL(row.url);
	const body = requestBody(row.body, row.headers['content-type'] ?? '');
	const data = body.value;
	return {
		operation_id: row.id, revision: row.revision, endpoint: endpoint(row.url), method: row.method,
		operation_label: row.label, query_keys: [...address.searchParams.keys()],
		body_fields: data && typeof data === 'object' ? Object.keys(data) : [], header_names: Object.keys(row.headers),
		cookie_names: row.cookie_names, cookie_values: 'browser session only', request_details: 'encrypted locally',
		last_seen: row.seen, expires_at: row.expires, observations: row.observations, status: row.status,
		reviewed_effect: row.effect, replayable: row.body_type !== 'unsupported' && preview(row).length <= 8000 && row.effect !== 'unreviewed' && row.expires > Date.now(),
		review_available: row.body_type !== 'unsupported' && preview(row).length <= 8000,
		trigger: row.click ? {kind: 'near_click', ...row.click} : {kind: 'background_or_uncorrelated'},
	};
}

export function preview(row: CapturedOperation) {
	const url = new URL(row.url);
	const query = Object.fromEntries([...url.searchParams].map(([key, value]) => [key, secretField.test(key) ? '[protected]' : value]));
	const body = requestBody(row.body, row.headers['content-type'] ?? '').value;
	return visibleText(JSON.stringify({
		method: row.method, endpoint: endpoint(row.url), query, headers: redact(row.headers), body: redact(body),
	}));
}

export function applyParameters(row: CapturedOperation, query: Record<string, string>, json: Record<string, unknown>) {
	const url = new URL(row.url);
	for (const [key, value] of Object.entries(query)) {
		if (secretField.test(key) || !url.searchParams.has(key)) {
			throw rejectedAction('INVALID_ARGS', 'Only observed noncredential query parameters may be changed.');
		}

		url.searchParams.set(key, value);
	}

	let {body} = row;
	if (Object.keys(json).length) {
		const data = requestBody(body, row.headers['content-type'] ?? '');
		if (data.type !== 'json' || !data.value || typeof data.value !== 'object' || Array.isArray(data.value)) {
			throw rejectedAction('INVALID_ARGS', 'JSON parameters require an observed JSON object request.');
		}

		const original = data.value as Record<string, unknown>;
		for (const [key, value] of Object.entries(json)) {
			if (secretField.test(key) || ['__proto__', 'constructor', 'prototype', 'operationName', 'action'].includes(key) || !Object.hasOwn(original, key)
				|| secretField.test(JSON.stringify(value))) {
				throw rejectedAction('INVALID_ARGS', 'Only observed noncredential JSON fields may be changed.');
			}

			original[key] = value;
		}

		body = JSON.stringify(original);
	}

	return {...row, url: url.href, body};
}

/** Keep whole JSON output within the caller's budget, including catalog metadata. */
export function boundedCatalog<T>(base: Record<string, unknown>, rows: T[], clicks: unknown[], maxChars: number, offset = 0) {
	const result = {
		...base, operations: [] as T[], clicks: [] as unknown[], total_operations: rows.length, omitted_operations: rows.length,
		offset, next_offset: null as number | null, truncated: rows.length > 0 || clicks.length > 0,
	};
	for (const [index, row] of rows.slice(offset).entries()) {
		result.operations.push(row);
		result.omitted_operations -= 1;
		result.next_offset = offset + index + 1 < rows.length ? offset + index + 1 : null;
		if (JSON.stringify(result, null, 2).length > maxChars) {
			result.operations.pop();
			result.omitted_operations += 1;
			result.next_offset = offset + index;
			break;
		}
	}

	for (const click of clicks) {
		result.clicks.push(click);
		if (JSON.stringify(result, null, 2).length > maxChars) {
			result.clicks.pop();
		}
	}

	result.truncated = result.omitted_operations > 0 || result.clicks.length < clicks.length;
	return result;
}
