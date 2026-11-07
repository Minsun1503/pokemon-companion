import {z} from 'zod';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import type {WindowsRequest} from './automation.js';

export const windowsActions = ['get_windows', 'get_ui', 'activate', 'invoke', 'set_value', 'select', 'toggle', 'expand', 'collapse', 'scroll', 'focus', 'read_text'] as const;
export const windowsFields = {
	window_id: z.string().regex(/^\d+$/).optional(),
	query: z.string().max(200).optional().describe('Case-insensitive name/automation-id filter; get_windows also matches process names.'),
	control_type: z.string().max(50).optional().describe('Optional role, e.g. Button, Edit, TabItem, Text.'),
	max_elements: z.number().int().min(1).max(250).default(60),
	max_depth: z.number().int().min(1).max(30).default(24),
	max_chars: z.number().int().min(1000).max(16000).default(6000),
	snapshot: z.string().regex(/^[a-f0-9]{32}$/).optional(),
	element_id: z.number().int().positive().optional(),
	text: z.string().max(8000).optional(),
	direction: z.enum(['up', 'down', 'left', 'right']).optional(),
};

const windowsRequestSchema = z.object({
	action: z.enum(windowsActions),
	...windowsFields,
});
export const windowsStepSchema = windowsRequestSchema.extend({
	window_step: z.number().int().min(0).max(15).optional().describe('Zero-based earlier get_windows (one match) or get_ui step supplying the window.'),
	target_step: z.number().int().min(0).max(15).optional().describe('Zero-based earlier get_ui step with exactly one untruncated control supporting this action.'),
	expect_value: z.string().max(160).optional().describe('For get_ui: require one untruncated control with this exact value before continuing.'),
}).strict();
export type WindowsStep = z.infer<typeof windowsStepSchema>;

const windowActions = ['get_ui', 'activate'];
const discoveryActions = ['get_windows', ...windowActions];

// Match atomic Windows responses: one compact text payload, without duplicate structured data.
function compactResult(data: Record<string, unknown>): CallToolResult {
	return {content: [{type: 'text', text: JSON.stringify(data)}]};
}

export function validateWindowsRequest(args: WindowsRequest): void {
	if (windowActions.includes(args.action) && !args.window_id) {
		throw new Error(`${args.action} requires window_id from get_windows.`);
	}

	if (!discoveryActions.includes(args.action) && (!args.snapshot || !args.element_id)) {
		throw new Error(`${args.action} requires snapshot and element_id from get_ui.`);
	}

	if (args.action === 'set_value' && args.text === undefined) {
		throw new Error('set_value requires text (an empty string clears the field).');
	}

	if (args.action === 'scroll' && !args.direction) {
		throw new Error('scroll requires direction.');
	}
}

function validateSteps(steps: WindowsStep[]): void {
	for (const [index, step] of steps.entries()) {
		if (step.window_step !== undefined) {
			if (!windowActions.includes(step.action) || step.window_id !== undefined || step.window_step >= index || !['get_windows', 'get_ui'].includes(steps[step.window_step]!.action)) {
				throw new Error(`Step ${index}: window_step must reference an earlier get_windows/get_ui and replace window_id on get_ui/activate.`);
			}
		}

		if (step.target_step !== undefined) {
			if (discoveryActions.includes(step.action) || step.snapshot !== undefined || step.element_id !== undefined || step.target_step >= index || steps[step.target_step]!.action !== 'get_ui') {
				throw new Error(`Step ${index}: target_step must reference an earlier get_ui and replace snapshot/element_id on a control action.`);
			}
		}

		if (step.expect_value !== undefined && step.action !== 'get_ui') {
			throw new Error(`Step ${index}: expect_value is supported only by get_ui.`);
		}

		// Validate the whole plan before any desktop mutation; references are resolved at execution.
		validateWindowsRequest({
			...step,
			window_id: step.window_step !== undefined ? '1' : step.window_id,
			snapshot: step.target_step !== undefined ? '0'.repeat(32) : step.snapshot,
			element_id: step.target_step !== undefined ? 1 : step.element_id,
		});
	}
}

class BatchReferenceError extends Error {
	constructor(message: string, readonly result: Record<string, unknown>, readonly resultStep: number) {
		super(message);
	}
}

function single(result: Record<string, unknown>, key: 'nodes' | 'windows', resultStep: number): Record<string, unknown> {
	const entries = result[key];
	if (result.truncated || !Array.isArray(entries) || entries.length !== 1 || (key === 'nodes' && result.matched !== 1)) {
		throw new BatchReferenceError(`Step ${resultStep} must contain exactly one untruncated ${key === 'nodes' ? 'control' : 'window'}; narrow the query or increase its budget.`, result, resultStep);
	}

	return entries[0] as Record<string, unknown>;
}

function resolveStep(step: WindowsStep, results: Record<string, unknown>[]): WindowsRequest {
	const {window_step: windowStep, target_step: targetStep} = step;
	const request = windowsRequestSchema.parse(step);
	if (windowStep !== undefined) {
		const source = results[windowStep]!;
		const window = Array.isArray(source.windows) ? single(source, 'windows', windowStep) : source.window as Record<string, unknown> | undefined;
		if (typeof window?.id !== 'string') {
			throw new BatchReferenceError('Referenced step has no window id.', source, windowStep);
		}

		request.window_id = window.id;
	}

	if (targetStep !== undefined) {
		const source = results[targetStep]!;
		const node = single(source, 'nodes', targetStep);
		if (!Array.isArray(node.actions) || !node.actions.includes(step.action) || typeof node.id !== 'number' || typeof source.snapshot !== 'string') {
			throw new BatchReferenceError(`Referenced control does not support ${step.action}.`, source, targetStep);
		}

		request.snapshot = source.snapshot;
		request.element_id = node.id;
	}

	return request;
}

/** Bound the entire response, including diagnostics, without altering stored reference results. */
function bounded(outcome: Record<string, unknown>, maxChars: number): Record<string, unknown> {
	const copy = structuredClone(outcome);
	const result = copy.result as Record<string, unknown> | undefined;
	const entries = Array.isArray(result?.nodes) ? result.nodes : Array.isArray(result?.windows) ? result.windows : undefined;
	while (JSON.stringify(copy).length > maxChars) {
		copy.truncated = true;
		if (result) {
			result.truncated = true;
		}

		if (entries?.length) {
			entries.pop();
		} else if (typeof result?.text === 'string' && result.text.length) {
			result.text = result.text.slice(0, Math.max(0, result.text.length - Math.max(1, JSON.stringify(copy).length - maxChars)));
		} else if (copy.result) {
			delete copy.result;
			copy.result_omitted = true;
		} else if (typeof copy.error === 'string' && copy.error.length) {
			copy.error = copy.error.slice(0, Math.max(0, copy.error.length - Math.max(1, JSON.stringify(copy).length - maxChars)));
		} else {
			break;
		}
	}

	return copy;
}

export async function runWindowsBatch(runtime: PokemonRuntime, steps: WindowsStep[], maxChars: number, signal?: AbortSignal) {
	validateSteps(steps);
	return runtime.computerBatch(async (perform) => {
		const results: Record<string, unknown>[] = [];
		for (const [index, step] of steps.entries()) {
			let started = false;
			try {
				// Desktop steps depend on prior results and must never run in parallel.
				// eslint-disable-next-line no-await-in-loop
				await perform(step.action === 'read_text' ? 'get_ui_text' : step.action, async () => {
					const request = resolveStep(step, results);
					started = true;
					const result = await runtime.windows.request(request);
					results.push(result);
					if (step.expect_value !== undefined && single(result, 'nodes', index).value !== step.expect_value) {
						throw new BatchReferenceError('Control value did not match expect_value; no subsequent steps were run.', result, index);
					}

					return compactResult({ok: true});
				});
			} catch (error) {
				const resultStep = error instanceof BatchReferenceError ? error.resultStep : results.length - 1;
				const result = error instanceof BatchReferenceError ? error.result : results[resultStep];
				return {
					...compactResult(bounded({
						ok: false, completed: index, total: steps.length, stopped_step: index, action: step.action, failed_step_started: started,
						error: (error instanceof Error ? error.message : String(error)).slice(0, 400),
						...(result ? {result_step: resultStep, result} : {}),
					}, maxChars)), isError: true,
				};
			}
		}

		return compactResult(bounded({
			ok: true, completed: steps.length, total: steps.length, result_step: steps.length - 1, result: results.at(-1),
		}, maxChars));
	}, signal);
}
