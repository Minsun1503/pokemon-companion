import {rejectedAction} from './errors.js';
export function loopbackEndpoint(value: string): string {
	const url = new URL(value);
	if (!['http:', 'ws:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
		throw rejectedAction('INVALID_ARGS', 'CDP endpoints must be local http:// or ws:// addresses without credentials or query tokens.');
	}

	return url.href;
}
