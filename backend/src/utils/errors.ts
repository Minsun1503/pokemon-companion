import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {serialize} from './timing.js';
import {isReadOnlyNativeAction} from '../windows/actions.js';

export type ErrorDetails = {
	code: string;
	disposition: {
		delivery: 'not_delivered' | 'delivered' | 'delivery_uncertain' | 'unknown';
		retry: 'safe' | 'unsafe' | 'unknown';
	};
	recovery?: {strategy: 'refresh_snapshot_then_retry_original'; requires_fresh_snapshot: true};
	progress?: {submitted_characters: number; total_characters: number};
};

export class DesktopError extends Error {
	constructor(message: string, readonly details: ErrorDetails) {
		super(message);
	}
}

/** Combine tracked dispatch evidence with explicit native rejection; never parse prose for delivery. */
export function executionErrorDetails(error: unknown, inputState: string, mutates: boolean, priorEffects = false): ErrorDetails {
	const known = errorDetails(error);
	const noInput = !mutates || inputState === 'not_sent';
	const delivery = inputState === 'applied' ? 'delivered' : noInput ? 'not_delivered' : 'delivery_uncertain';
	if (!priorEffects && known.disposition.delivery === 'not_delivered' && inputState !== 'applied' && (noInput || !['CANCELLED', 'PAUSED', 'TIMEOUT'].includes(known.code))) {
		return known;
	}

	return {
		code: known.code === 'INTERNAL' ? 'ACTION_FAILED' : known.code, disposition: {
			delivery, retry: noInput && !['CANCELLED', 'PAUSED', 'INVALID_ARGS'].includes(known.code) ? 'safe' : 'unsafe',
		},
	};
}

export function errorDetails(error: unknown): ErrorDetails {
	return error instanceof DesktopError ? error.details : {code: 'INTERNAL', disposition: {delivery: 'unknown', retry: 'unknown'}};
}

export function rejectedAction(code: string, message: string): DesktopError {
	return new DesktopError(message, {code, disposition: {delivery: 'not_delivered', retry: code === 'PAUSED' || code === 'CANCELLED' || code === 'INVALID_ARGS' ? 'unsafe' : 'safe'}});
}

export function nativeFailure(code: string, message: string, action: string): DesktopError {
	const readOnly = isReadOnlyNativeAction(action);
	return new DesktopError(message, {
		code, disposition: {
			delivery: readOnly ? 'not_delivered' : 'delivery_uncertain',
			retry: readOnly && code !== 'PAUSED' && code !== 'CANCELLED' ? 'safe' : 'unsafe',
		},
	});
}

/** Only explicit worker evidence may turn an uncertain input failure into a safe retry. */
export function workerFailure(message: string, details: unknown, action: string): DesktopError {
	if (details && typeof details === 'object' && 'code' in details && typeof details.code === 'string' && details.code.length > 0 && details.code.length <= 64
		&& 'disposition' in details && details.disposition && typeof details.disposition === 'object'
		&& 'delivery' in details.disposition && details.disposition.delivery === 'not_delivered'
		&& 'retry' in details.disposition && ['safe', 'unsafe'].includes(String(details.disposition.retry))) {
		return new DesktopError(message, {
			code: details.code, disposition: {delivery: 'not_delivered', retry: ['INVALID_ARGS', 'PAUSED', 'CANCELLED'].includes(details.code) || details.disposition.retry === 'unsafe' ? 'unsafe' : 'safe'},
			...(details.code === 'STALE_REF' ? {recovery: {strategy: 'refresh_snapshot_then_retry_original' as const, requires_fresh_snapshot: true as const}} : {}),
		});
	}

	return nativeFailure('ACTION_FAILED', message, action);
}

export function errorResult(error: unknown, maxChars: number): CallToolResult {
	const outcome: {contract_version: number; ok: false; error: string; error_details: ErrorDetails; truncated?: boolean} = {
		contract_version: 1, ok: false, error: error instanceof Error ? error.message : String(error), error_details: errorDetails(error),
	};
	while (serialize(outcome).length > maxChars && outcome.error.length) {
		outcome.truncated = true;
		outcome.error = outcome.error.slice(0, Math.max(0, outcome.error.length - Math.max(1, serialize(outcome).length - maxChars)));
	}

	return {isError: true, content: [{type: 'text', text: serialize(outcome)}]};
}
