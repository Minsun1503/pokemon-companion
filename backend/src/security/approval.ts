import {randomUUID, createHash} from 'node:crypto';
import {DesktopError} from '../utils/errors.js';

export type ApprovalIntent = {
	action_id: string; digest: string; scope_hash: string; tool: string; operation: string;
	target: string; origin: string; path: string; input_hash: string; state_hash: string; input_preview: string;
	target_length: number; input_length: number; conversation: string; scope_allowed: boolean; reconciliation?: boolean; wait_for_decision?: boolean;
};
export function hashState(value: unknown) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Descriptions are server-derived. App labels remain untrusted display data. */
export function visibleText(value: string) {
	// eslint-disable-next-line no-control-regex -- Invisible controls must be rendered explicitly in approval previews.
	return value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function approvalIntent(tool: string, operation: string, target: string, url: string, input: string, state: unknown, binding: unknown, display: {input?: string; conversation?: string; scope?: unknown; scopeAllowed?: boolean; operationClass?: string} = {}): ApprovalIntent {
	const draft = display.input ?? input;
	const preview = visibleText(draft);
	if (input.length > 8000 || draft.length > 8000 || preview.length > 8000) {
		throw new DesktopError('Input exceeds the complete approval display limit. No action was sent.', {code: 'APPROVAL_DISPLAY_TOO_LARGE', disposition: {delivery: 'not_delivered', retry: 'unsafe'}});
	}

	const address = new URL(url);
	const base = {
		tool, operation, target: visibleText(target).slice(0, 200), origin: address.origin, path: visibleText(address.pathname), state_hash: hashState(state),
	};
	const input_hash = hashState(input);
	const intent: ApprovalIntent = {
		action_id: randomUUID(), ...base, input_hash, input_preview: preview, target_length: target.length, input_length: draft.length,
		conversation: visibleText(display.conversation ?? '').slice(0, 200), scope_allowed: display.scopeAllowed ?? Boolean(display.conversation),
		scope_hash: hashState({
			tool, operation: display.operationClass ?? operation, origin: address.origin, path: address.pathname, scope: display.scope ?? binding,
		}), digest: hashState({...base, input_hash, binding}),
	};
	if (Buffer.byteLength(JSON.stringify(intent)) > 32768) {
		throw new DesktopError('Approval request exceeds the channel limit. No action was sent.', {code: 'APPROVAL_DISPLAY_TOO_LARGE', disposition: {delivery: 'not_delivered', retry: 'unsafe'}});
	}

	return intent;
}

export function approvalRequired(actionId: string) {
	return new DesktopError(`Approval required for action ${actionId}. Review the companion dialog, then read the target again before retrying. No action was sent.`, {code: 'APPROVAL_REQUIRED', action_id: actionId, disposition: {delivery: 'not_delivered', retry: 'unsafe'}});
}
