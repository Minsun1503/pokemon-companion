import {describe, expect, it} from 'vitest';
import {
	DesktopError, errorDetails, errorResult, executionErrorDetails, nativeFailure, rejectedAction, workerFailure,
} from './errors.js';

describe('Desktop error evidence', () => {
	it('keeps observed prior effects applied even if later verification failed before dispatch', () => {
		expect(executionErrorDetails(rejectedAction('TIMEOUT', 'verification expired'), 'applied', true).disposition).toEqual({delivery: 'delivered', retry: 'unsafe'});
		expect(executionErrorDetails(new Error('lost write response'), 'unknown', true).disposition).toEqual({delivery: 'delivery_uncertain', retry: 'unsafe'});
		expect(executionErrorDetails(rejectedAction('CANCELLED', 'stopped'), 'not_sent', true).disposition).toEqual({delivery: 'not_delivered', retry: 'unsafe'});
	});
	it('requires explicit native evidence before allowing an input retry', () => {
		const message = 'STALE_REF: no input was sent';
		expect(workerFailure(message, undefined, 'invoke').details.disposition).toEqual({delivery: 'delivery_uncertain', retry: 'unsafe'});
		const proven = workerFailure(message, {code: 'STALE_REF', disposition: {delivery: 'not_delivered', retry: 'safe'}}, 'invoke');
		expect(proven.details).toMatchObject({code: 'STALE_REF', disposition: {delivery: 'not_delivered', retry: 'safe'}, recovery: {requires_fresh_snapshot: true}});
	});

	it.each([null, {}, {code: 'STALE_REF'}, {code: 'STALE_REF', disposition: {delivery: 'delivery_uncertain', retry: 'safe'}}])('does not trust incomplete or contradictory worker evidence: %j', (details) => {
		expect(workerFailure('failed', details, 'toggle').details.disposition.retry).toBe('unsafe');
	});

	it('allows a read to be repeated but keeps unknown failures unknown', () => {
		expect(nativeFailure('TIMEOUT', 'timed out', 'get_ui').details.disposition.retry).toBe('safe');
		expect(errorDetails(new Error('STALE_REF'))).toEqual({code: 'INTERNAL', disposition: {delivery: 'unknown', retry: 'unknown'}});
	});

	it.each(['PAUSED', 'CANCELLED'])('does not encourage an automatic read retry after %s', (code) => {
		expect(nativeFailure(code, 'stopped by user', 'get_ui').details.disposition.retry).toBe('unsafe');
	});

	it('keeps escaped error text bounded while retaining delivery evidence', () => {
		const result = errorResult(new DesktopError('\u0000'.repeat(8000), {code: 'TIMEOUT', disposition: {delivery: 'delivery_uncertain', retry: 'unsafe'}}), 1000);
		expect(result.isError).toBe(true);
		expect(result).not.toHaveProperty('structuredContent');
		const {text} = (result.content.find((item) => item.type === 'text')!);
		expect(text.length).toBeLessThanOrEqual(1000);
		expect(JSON.parse(text)).toMatchObject({truncated: true, error_details: {code: 'TIMEOUT', disposition: {retry: 'unsafe'}}});
	});
});
