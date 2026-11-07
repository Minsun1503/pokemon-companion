import {z} from 'zod';
import {serialize} from '../utils/timing.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import type {WindowsRequest} from './automation.js';
import {setTimeout as delay} from 'node:timers/promises';

export const windowsActions = ['get_windows', 'get_ui', 'activate', 'invoke', 'set_value', 'select', 'toggle', 'expand', 'collapse', 'scroll', 'focus', 'read_text', 'wait_for', 'launch'] as const;
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
	expect_value: z.string().max(160).optional().describe('For wait_for (or batch get_ui): require a control with this exact value.'),
	timeout_ms: z.number().int().min(1).max(15000).optional().describe('wait_for/launch timeout; default 5000 ms, max 15000.'),
};

const windowsRequestSchema = z.object({
	action: z.enum(windowsActions),
	...windowsFields,
});
export const windowsStepSchema = windowsRequestSchema.extend({
	window_step: z.number().int().min(0).max(15).optional().describe('Zero-based earlier get_windows/launch (one match) or get_ui/wait_for step supplying the window.'),
	target_step: z.number().int().min(0).max(15).optional().describe('Zero-based earlier get_ui/wait_for step with exactly one untruncated control supporting this action.'),
}).strict();
export type WindowsStep = z.infer<typeof windowsStepSchema>;

const windowActions = ['get_ui', 'activate', 'wait_for'];
const discoveryActions = ['get_windows', 'launch', ...windowActions];
const windowSources = ['get_windows', 'get_ui', 'wait_for', 'launch'];
const controlSources = ['get_ui', 'wait_for'];

// Match atomic Windows responses: one compact text payload, without duplicate structured data.
function compactResult(data: Record<string, unknown>): CallToolResult {
	return {content: [{type: 'text', text: serialize(data)}]};
}

export function validateWindowsRequest(args: WindowsRequest): void {
	if (args.action === 'wait_for' && !args.query && !args.control_type) {
		throw new Error('wait_for requires query or control_type.');
	}

	if (args.action === 'launch') {
		const target = args.text;
		if (!target || /["<>|]/.test(target) || [...target].some((character) => character.charCodeAt(0) < 32)) {
			throw new Error('launch requires text containing an http/https URL or executable name/path, without shell commands or arguments.');
		}

		if (/^https?:/i.test(target)) {
			const url = new URL(target);
			if (!url.hostname || /\s/.test(target)) {
				throw new Error('launch requires a valid http/https URL.');
			}

			if (!args.query) {
				throw new Error('launch of a URL requires query to identify the resulting window.');
			}
		} else if (/[*?]/.test(target) || (/[\\/]/.test(target) && !/\.exe$/i.test(target)) || (/\.[^\\/.]+$/.test(target) && !/\.exe$/i.test(target)) || (target.includes(':') && !/^[a-z]:[\\/]/i.test(target))) {
			throw new Error('launch accepts only an http/https URL or executable name/path.');
		}
	}

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
			if (!windowActions.includes(step.action) || step.window_id !== undefined || step.window_step >= index || !windowSources.includes(steps[step.window_step]!.action)) {
				throw new Error(`Step ${index}: window_step must reference an earlier get_windows/get_ui and replace window_id on get_ui/activate.`);
			}
		}

		if (step.target_step !== undefined) {
			if (discoveryActions.includes(step.action) || step.snapshot !== undefined || step.element_id !== undefined || step.target_step >= index || !controlSources.includes(steps[step.target_step]!.action)) {
				throw new Error(`Step ${index}: target_step must reference an earlier get_ui and replace snapshot/element_id on a control action.`);
			}
		}

		if (step.expect_value !== undefined && !['get_ui', 'wait_for'].includes(step.action)) {
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
	const {expect_value: expectation, ...fields} = step;
	const request = windowsRequestSchema.parse(fields);
	if (step.action === 'wait_for') {
		request.expect_value = expectation;
	}

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
	while (serialize(copy).length > maxChars) {
		copy.truncated = true;
		if (result) {
			result.truncated = true;
		}

		if (entries?.length) {
			entries.pop();
		} else if (typeof result?.text === 'string' && result.text.length) {
			result.text = result.text.slice(0, Math.max(0, result.text.length - Math.max(1, serialize(copy).length - maxChars)));
		} else if (typeof result?.started === 'string' && result.started.length) {
			result.started_clipped = true;
			result.started = result.started.slice(0, Math.max(0, result.started.length - Math.max(1, serialize(copy).length - maxChars)));
		} else if (copy.result) {
			delete copy.result;
			copy.result_omitted = true;
		} else if (typeof copy.error === 'string' && copy.error.length) {
			copy.error = copy.error.slice(0, Math.max(0, copy.error.length - Math.max(1, serialize(copy).length - maxChars)));
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
					let result = await runWindowsRequest(runtime, request, signal);
					results.push(result);
					if (step.action === 'get_ui' && step.expect_value !== undefined && single(result, 'nodes', index).value !== step.expect_value) {
						if (signal?.aborted || runtime.companion.state.paused) {
							throw new Error('Computer action cancelled or paused before execution.');
						}

						// UIA may still expose the previous view; re-read once, never replay the input.
						result = await runtime.windows.request(request);
						results[index] = result;
					}

					if (step.action === 'get_ui' && step.expect_value !== undefined && single(result, 'nodes', index).value !== step.expect_value) {
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

/** Poll read-only discovery; launch happens once and input is never replayed. */
export async function runWindowsRequest(runtime: PokemonRuntime, args: WindowsRequest, signal?: AbortSignal): Promise<Record<string, unknown>> {
	if (!['wait_for', 'launch'].includes(args.action)) {
		return runtime.windows.request(args);
	}

	const deadline = performance.now() + (args.timeout_ms ?? 5000);
	let timeoutError = `${args.action} timed out after ${args.timeout_ms ?? 5000} ms waiting for ${(args.query || args.control_type || args.text || '').slice(0, 200)}.`;
	const check = () => {
		if (signal?.aborted) {
			throw new Error('Computer action cancelled.');
		}

		if (runtime.companion.state.paused) {
			throw new Error('Computer control is paused by the user. Ask them to resume from the Pokémon tray or Ctrl+Shift+P.');
		}

		if (performance.now() >= deadline) {
			throw new Error(timeoutError);
		}
	};

	const read = async (request: WindowsRequest) => {
		check();
		const result = await runtime.windows.request(request, {
			signal, timeoutMs: Math.max(1, deadline - performance.now()), paused: () => runtime.companion.state.paused, timeoutError,
		});
		check();
		return result;
	};

	const launched = args.action === 'launch' ? await read(args) : undefined;
	if (launched) {
		timeoutError = `launch started ${String(launched.started).slice(0, 200)}; ${timeoutError}`;
	}

	const request = launched
		? {...args, action: 'get_windows', query: args.query || String(launched.query)}
		: {...args, action: 'get_ui'};
	for (;;) {
		// eslint-disable-next-line no-await-in-loop
		const result = await read(request);
		const entries = (launched ? result.windows : result.nodes) as Record<string, unknown>[];
		const matches = entries.filter((node) => args.expect_value === undefined || (!node.value_clipped && node.value === args.expect_value));
		if (matches.length) {
			if (launched) {
				return bounded({result: {...result, started: launched.started}}, args.max_chars ?? 6000).result as Record<string, unknown>;
			}

			return {...result, nodes: matches, matched: result.truncated ? result.matched : matches.length};
		}

		// eslint-disable-next-line no-await-in-loop
		await delay(Math.min(100, Math.max(1, deadline - performance.now())), undefined, {signal}).catch(() => {
			throw new Error('Computer action cancelled.');
		});
	}
}
