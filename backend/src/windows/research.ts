import {z} from 'zod';
import {createHash} from 'node:crypto';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import {serialize} from '../utils/timing.js';
import {executionErrorDetails, rejectedAction} from '../utils/errors.js';
import type {WindowsRequest} from './automation.js';

const shared = {
	task_id: z.uuid().optional(),
	window_id: z.string().regex(/^[1-9]\d*$/),
	window_ref: z.string().regex(/^[a-f0-9]{32}$/).optional(),
	document_name: z.string().min(1).max(160),
	ignore_case: z.boolean().default(true),
	context_chars: z.number().int().min(0).max(1000).default(300),
	timeout_ms: z.number().int().min(1).max(15000).default(5000),
	max_chars: z.number().int().min(1000).max(16000).default(6000),
};
const query = z.string().min(1).max(200);
export const researchSchema = z.discriminatedUnion('action', [
	z.object({action: z.literal('find_text'), ...shared, query}).strict(),
	z.object({action: z.literal('find_many'), ...shared, queries: z.array(query).min(1).max(8)}).strict(),
]);
export type ResearchRequest = z.infer<typeof researchSchema>;

export function researchResult(data: Record<string, unknown>, maxChars: number): CallToolResult {
	const out = structuredClone(data);
	const rows = Array.isArray(out.results) ? out.results as Record<string, unknown>[] : [out];
	if (serialize(out).length > maxChars && rows.some((row) => typeof row.text === 'string')) {
		const texts = rows.map((row) => typeof row.text === 'string' ? row.text : '');
		out.response_truncated = true;
		const apply = (cap: number) => {
			rows.forEach((row, index) => {
				const full = texts[index]!;
				let end = Math.min(full.length, cap);
				if (end && /[\uD800-\uDBFF]/.test(full[end - 1]!)) {
					end -= 1;
				}

				row.text = full.slice(0, end);
				row.excerpt_truncated = end < full.length;
				row.excerpt_sha256 = createHash('sha256').update(row.text as string, 'utf16le').digest('hex');
			});
		};

		let low = 0;
		let high = Math.max(...texts.map((text) => text.length));
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			apply(middle);
			if (serialize(out).length <= maxChars) {
				low = middle;
			} else {
				high = middle - 1;
			}
		}

		apply(low);
	}

	for (const key of ['text', 'error']) {
		if (serialize(out).length <= maxChars || typeof out[key] !== 'string') {
			continue;
		}

		const full = out[key];
		out.response_truncated = true;
		let low = 0;
		let high = full.length;
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			out[key] = full.slice(0, middle);
			if (serialize(out).length <= maxChars) {
				low = middle;
			} else {
				high = middle - 1;
			}
		}

		if (low && /[\uD800-\uDBFF]/.test(full[low - 1]!)) {
			low -= 1;
		}

		out[key] = full.slice(0, low);
	}

	if (serialize(out).length > maxChars) {
		return {
			isError: true, content: [{
				type: 'text', text: serialize({
					contract_version: 1, ok: false,
					input_state: 'not_sent', error: 'Response metadata exceeds max_chars; increase the budget or request fewer queries.',
					error_details: executionErrorDetails(rejectedAction('OUTPUT_BUDGET', 'Insufficient response budget.'), 'not_sent', false),
					results_returned: 0, requested_queries: Array.isArray(data.results) ? data.results.length : 1,
					required_min_chars: serialize(out).length,
				}),
			}],
		};
	}

	return {content: [{type: 'text', text: serialize(out)}], ...(out.ok === false ? {isError: true} : {})};
}

/** Read only the selected document, preserving its native identity and the user's browser session. */
export async function runResearch(runtime: PokemonRuntime, input: unknown, signal?: AbortSignal): Promise<CallToolResult> {
	const args = researchSchema.parse(input);
	let calls = 0;
	let phase = 'queue';
	return runtime.computerBatch(async (perform) => {
		const deadline = performance.now() + args.timeout_ms;
		const check = () => {
			if (signal?.aborted || runtime.companion.state.paused) {
				throw rejectedAction(signal?.aborted ? 'CANCELLED' : 'PAUSED', 'Research reading cancelled or paused. No input was sent.');
			}

			if (performance.now() >= deadline) {
				throw rejectedAction('TIMEOUT', 'Research retrieval exceeded its deadline.');
			}
		};

		const request = async (native: WindowsRequest) => {
			check();
			let result: Record<string, unknown> = {};
			await perform('get_ui_text', async () => {
				check();
				calls += 1;
				result = await runtime.windows.request(native, {
					signal, timeoutMs: Math.max(1, deadline - performance.now()), paused: () => runtime.companion.state.paused,
					timeoutError: 'Research retrieval native request timed out.',
				});
				check();
				return {content: [{type: 'text', text: '{"ok":true}'}]};
			});
			return result;
		};

		phase = 'document_discovery';
		const ui = await request({
			action: 'get_ui', window_id: args.window_id, window_ref: args.window_ref,
			query: args.document_name, control_type: 'Document', max_depth: 30, max_elements: 60, max_chars: 16000,
		});
		if (ui.complete !== true || ui.truncated || !Array.isArray(ui.nodes) || typeof ui.snapshot !== 'string') {
			throw rejectedAction('INCOMPLETE_SNAPSHOT', 'Research requires a complete document observation.');
		}

		const nodes = (ui.nodes as Record<string, unknown>[]).filter((node) => node.name === args.document_name && node.role === 'Document');
		if (nodes.length !== 1 || !nodes[0]!.targetable || !Number.isInteger(nodes[0]!.id) || !Array.isArray(nodes[0]!.actions) || !nodes[0]!.actions.includes('read_text')) {
			throw rejectedAction('AMBIGUOUS_TARGET', 'Find one exact, readable, capture-proven Document before retrieving information.');
		}

		phase = 'range_search';
		const result = await request({
			action: args.action === 'find_text' ? 'find_text_range' : 'find_text_ranges',
			snapshot: ui.snapshot, element_id: nodes[0]!.id as number,
			...(args.action === 'find_text' ? {text: args.query} : {queries: args.queries}),
			context_chars: args.context_chars, ignore_case: args.ignore_case, max_chars: 16000,
		});
		return researchResult({
			contract_version: 1, ok: true, action: args.action, document_name: args.document_name,
			...(args.action === 'find_text' ? {query: args.query} : {requested_queries: args.queries.length}),
			input_state: 'not_sent', native_calls: calls, ...result,
		}, args.max_chars);
	}, signal).catch((error: unknown) => researchResult({
		contract_version: 1, ok: false, phase, input_state: 'not_sent', native_calls: calls,
		error: (error instanceof Error ? error.message : String(error)).slice(0, 400),
		error_details: executionErrorDetails(error, 'not_sent', false),
	}, args.max_chars));
}
