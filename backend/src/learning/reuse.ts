import type {WindowsStep} from '../windows/batch.js';
import {similarity, type Vector} from './model.js';

export type QueryAction = 'edit' | 'read' | 'open' | 'search' | 'send' | 'delete' | 'save' | 'interact';
export type RequestIntent = {negated: boolean; actions: QueryAction[]};
type Reusable = {kind: 'windows' | 'guide'; steps: WindowsStep[]; actions?: QueryAction[]; negative_contexts?: Vector[]};
const vocabulary: Record<QueryAction, string[]> = {
	edit: ['type', 'enter', 'fill', 'write', 'populate', 'update', 'set', 'put', 'complete', 'edit', 'nhap', 'ghi', 'dien', 'sua'],
	read: ['read', 'inspect', 'view', 'show', 'doc', 'xem'],
	open: ['open', 'launch', 'start', 'mo'],
	search: ['search', 'find', 'lookup', 'tim'],
	send: ['send', 'reply', 'forward', 'gui'],
	delete: ['delete', 'remove', 'erase', 'clear', 'xoa'],
	save: ['save', 'persist', 'luu'],
	interact: ['click', 'press', 'invoke', 'select', 'toggle', 'bam', 'chon'],
};

// Separate matching metadata keeps the existing hashed features/weights intact.
// These small English/Vietnamese vocabularies are hints, not a language parser.
export function requestIntent(query: string): RequestIntent {
	const text = query.slice(0, 4096).replace(/"[^"]*"|“[^”]*”|`[^`]*`/g, ' ')
		.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/đ/g, 'd');
	const negated = /\b(?:do\s+not|don['’]t|never|avoid|khong|dung)\b/.test(text);
	const words = new Set(text.replace(/[^\p{L}\p{N}]+/gu, ' ').split(' '));
	const actions = (Object.keys(vocabulary) as QueryAction[]).filter((action) => vocabulary[action].some((word) => words.has(word)));
	return {negated, actions};
}

export function compatibleIntent(intent: RequestIntent, recipe: Reusable): boolean {
	if (intent.negated) {
		return false;
	}

	// Old journals have no action metadata. Their executable steps still reveal
	// supported edits/interactions; unknown guide capabilities remain unknown.
	const actions = recipe.actions?.length
		? recipe.actions
		: (recipe.kind === 'windows'
			? [
				...(recipe.steps.some((step) => step.action === 'set_value') ? ['edit' as const] : []),
				...(recipe.steps.some((step) => ['invoke', 'select', 'toggle'].includes(step.action)) ? ['interact' as const] : []),
			]
			: []);
	return actions.length === 0 || intent.actions.length === 0
		|| (intent.actions.every((action) => actions.includes(action)) && actions.every((action) => intent.actions.includes(action)));
}

export function rejectedContext(recipe: Reusable, vector: Vector, positiveMatch: number, keys: string[]): boolean {
	// A nearby successful context remains usable. An exact/very close rejected
	// context wins only when it matches at least as well as every positive one.
	return (recipe.negative_contexts ?? []).some((context) => {
		const negativeMatch = similarity(vector, context, keys);
		return negativeMatch >= 0.9 && negativeMatch >= positiveMatch - 1e-9;
	});
}
