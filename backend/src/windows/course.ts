import {z} from 'zod';
import {setTimeout as delay} from 'node:timers/promises';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import type {WindowsRequest} from './automation.js';
import {serialize} from '../utils/timing.js';

// Reject multiline/control characters in accessible names.
// eslint-disable-next-line no-control-regex
const name = z.string().min(1).max(160).refine((value) => !/[\u0000-\u001f]/.test(value), 'Accessible names must be single-line text.');
const version = z.string().regex(/^[a-f0-9]{64}$/);
const shared = {
	window_id: z.string().regex(/^[1-9]\d*$/),
	document_name: name.describe('Exact accessible name of the selected course/lesson Document, not a broad browser query.'),
	timeout_ms: z.number().int().min(1).max(15000).default(5000),
	max_chars: z.number().int().min(1000).max(16000).default(8000),
};
const pageChars = z.number().int().min(100).max(12000).default(6000);
export const courseSchema = z.discriminatedUnion('action', [
	z.object({
		action: z.literal('read_lesson'), ...shared,
		offset: z.number().int().min(0).max(1000000).default(0),
		page_chars: pageChars,
		version: version.optional().describe('Required for subsequent pages; use the version from offset 0.'),
	}).strict(),
	z.object({
		action: z.literal('open_lesson'), ...shared,
		navigation_name: name.describe('Exact lesson/navigation control name observed in the UI.'),
		navigation_role: z.enum(['Button', 'TabItem']).default('Button'),
		ready_text: z.string().min(1).max(200).describe('Unique text inside the requested lesson. Navigation must change the document version and expose this marker.'),
		page_chars: pageChars,
	}).strict(),
	z.object({
		action: z.literal('search_courses'), ...shared,
		search_name: name.default('Search'),
		search_text: z.string().min(1).max(160),
		ready_text: z.string().min(1).max(200).describe('Unique expected course-result text. Use a result-specific marker, not the echoed search query.'),
		page_chars: pageChars,
	}).strict(),
	z.object({
		action: z.literal('check_completion'), ...shared,
		completion_text: z.string().min(12).max(200).describe('Specific completion message/lesson count in the selected course, not a generic Completed label.'),
	}).strict(),
]).superRefine((args, ctx) => {
	if (args.action === 'read_lesson' && args.offset > 0 && !args.version) {
		ctx.addIssue({code: 'custom', path: ['version'], message: 'Reading subsequent pages requires the original version.'});
	}
});
export type CourseRequest = z.infer<typeof courseSchema>;
type Control = {snapshot: string; id: number; actions: string[]; value?: unknown; value_clipped?: boolean; enabled?: boolean};
type Perform = (action: string, execute: () => Promise<CallToolResult>) => Promise<CallToolResult>;
const compact = (data: Record<string, unknown>): CallToolResult => ({content: [{type: 'text', text: serialize(data)}]});

/** Bound escaped JSON while keeping the cursor at the end of text actually returned. */
export function courseResult(data: Record<string, unknown>, maxChars: number): CallToolResult {
	const out = structuredClone(data);
	// Preserve a useful lesson page before spending its budget on optional evidence context.
	for (const key of ['match_excerpt', 'text', 'error']) {
		if (serialize(out).length <= maxChars || typeof out[key] !== 'string') {
			continue;
		}

		const full = out[key];
		out.response_truncated = true;
		const apply = (end: number) => {
			out[key] = full.slice(0, end);
			if (key === 'text') {
				out.next_offset = Number(out.offset ?? 0) + end;
				out.has_more = true;
			}
		};

		let low = 0;
		let high = full.length;
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			apply(middle);
			if (serialize(out).length <= maxChars) {
				low = middle;
			} else {
				high = middle - 1;
			}
		}

		if (low && /[\uD800-\uDBFF]/.test(full[low - 1]!)) {
			low -= 1;
		}

		apply(low);
	}

	return {...compact(out), ...(out.ok === false ? {isError: true} : {})};
}

class CourseRun {
	calls = 0;
	phase = 'discovery';
	input: 'not_sent' | 'applied' | 'unknown' = 'not_sent';
	private readonly deadline: number;
	constructor(
		readonly runtime: PokemonRuntime,
		readonly args: CourseRequest,
		readonly perform: Perform,
		readonly signal?: AbortSignal,
	) {
		this.deadline = performance.now() + args.timeout_ms;
	}

	check(): void {
		if (this.signal?.aborted) {
			throw new Error('Course action cancelled. Re-read the current UI before continuing.');
		}

		if (this.runtime.companion.state.paused) {
			throw new Error('Computer control is paused by the user. Resume from the companion controls, then re-read the current UI.');
		}

		if (performance.now() >= this.deadline) {
			throw new Error(`Course operation timed out during ${this.phase}; input was not replayed. Re-read the current UI.`);
		}
	}

	async request(args: WindowsRequest, sendsInput = false): Promise<Record<string, unknown>> {
		this.check();
		let result: Record<string, unknown> = {};
		await this.perform(args.action === 'read_text_page' ? 'get_ui_text' : args.action, async () => {
			this.check();
			this.calls += 1;
			if (sendsInput) {
				this.input = 'unknown';
			}

			result = await this.runtime.windows.request(args, {
				signal: this.signal, timeoutMs: Math.max(1, this.deadline - performance.now()),
				paused: () => this.runtime.companion.state.paused,
				timeoutError: `Course native request timed out during ${this.phase}; re-read the current UI.`,
			});
			if (sendsInput) {
				this.input = 'applied';
			}

			this.check();
			return compact({ok: true});
		});
		return result;
	}

	async pause(): Promise<void> {
		this.check();
		await delay(Math.min(100, Math.max(1, this.deadline - performance.now())), undefined, {signal: this.signal});
	}

	async control(exactName: string, role: string): Promise<Control | undefined> {
		const ui = await this.request({
			action: 'get_ui', window_id: this.args.window_id, query: exactName, control_type: role,
			max_elements: 60, max_depth: 30, max_chars: 16000,
		});
		if (ui.truncated) {
			throw new Error('Control discovery was truncated; narrow the accessible name before acting.');
		}

		if (!Array.isArray(ui.nodes) || typeof ui.snapshot !== 'string') {
			throw new Error('Invalid course control discovery response.');
		}

		const nodes = (ui.nodes as Record<string, unknown>[]).filter((node) => node.name === exactName && node.role === role);
		if (nodes.length > 1) {
			throw new Error(`Ambiguous exact ${role} name: ${exactName}. No candidate was selected.`);
		}

		const node = nodes[0];
		if (!node) {
			return undefined;
		}

		if (typeof node.id !== 'number') {
			throw new Error('Invalid course control id.');
		}

		return {
			...node, id: node.id, snapshot: ui.snapshot, actions: Array.isArray(node.actions) ? node.actions as string[] : [],
		};
	}

	async page(offset = 0, count = 100, expectedVersion?: string, marker?: string): Promise<Record<string, unknown> | undefined> {
		const doc = await this.control(this.args.document_name, 'Document');
		if (!doc) {
			return undefined;
		}

		if (!doc.actions.includes('read_text')) {
			throw new Error('Selected lesson does not expose readable text. Use the source document or a visual fallback.');
		}

		const page = await this.request({
			action: 'read_text_page', snapshot: doc.snapshot, element_id: doc.id,
			text_offset: offset, text_length: count, expected_version: expectedVersion, required_text: marker,
			// Internal page transport allows JSON escaping; the MCP response is bounded separately.
			max_chars: 80000,
		});
		if (typeof page.text !== 'string' || typeof page.version !== 'string' || typeof page.offset !== 'number'
			|| typeof page.total_characters !== 'number' || typeof page.has_more !== 'boolean'
			|| (page.truncated && page.response_truncated !== true)) {
			throw new Error('Incomplete native course page response; restart at offset 0.');
		}

		return page;
	}

	async send(control: Control, action: 'invoke' | 'select' | 'set_value', text?: string): Promise<void> {
		if (!control.actions.includes(action) || control.enabled === false) {
			throw new Error(`Course control does not support an enabled ${action}. No input was sent.`);
		}

		// Once native input starts, a failure cannot prove that the app did nothing.
		await this.request({
			action, snapshot: control.snapshot, element_id: control.id, text,
		}, true);
	}

	// UI polling is sequential: every read must finish before waiting or sending input.
	/* eslint-disable no-await-in-loop */
	async run(): Promise<Record<string, unknown>> {
		const {args} = this;
		if (args.action === 'read_lesson' || args.action === 'check_completion') {
			this.phase = args.action === 'read_lesson' ? 'reading' : 'completion_check';
			for (;;) {
				const page = await this.page(
					args.action === 'read_lesson' ? args.offset : 0,
					args.action === 'read_lesson' ? args.page_chars : 100,
					args.action === 'read_lesson' ? args.version : undefined,
					args.action === 'check_completion' ? args.completion_text : undefined,
				);
				if (page) {
					if (args.action === 'check_completion') {
						return {
							status: page.source_truncated ? 'unknown' : page.match_count === 1 ? 'confirmed' : page.match_count === 0 ? 'not_found' : 'ambiguous',
							match_count: page.match_count, match_excerpt: page.match_excerpt,
							version: page.version, source_truncated: page.source_truncated,
						};
					}

					return page;
				}

				await this.pause();
			}
		}

		this.phase = 'before_navigation';
		const baseline = await this.page();
		let noChangeRequired = false;
		if (args.action === 'open_lesson') {
			this.phase = 'navigation_control';
			let target: Control | undefined;
			while (!target || target.enabled === false) {
				target = await this.control(args.navigation_name, args.navigation_role);
				if (!target || target.enabled === false) {
					await this.pause();
				}
			}

			await this.send(target, args.navigation_role === 'TabItem' ? 'select' : 'invoke');
		} else {
			this.phase = 'search_field';
			let field: Control | undefined;
			while (!field) {
				field = await this.control(args.search_name, 'Edit');
				if (!field) {
					await this.pause();
				}
			}

			noChangeRequired = !field.value_clipped && field.value === args.search_text;
			if (!noChangeRequired) {
				await this.send(field, 'set_value', args.search_text);
			}

			this.phase = 'search_value_verification';
			for (;;) {
				const current = await this.control(args.search_name, 'Edit');
				if (current && !current.value_clipped && current.value === args.search_text) {
					break;
				}

				await this.pause();
			}
		}

		this.phase = 'lesson_ready';
		for (;;) {
			const page = await this.page(0, args.page_chars, undefined, args.ready_text);
			if (page?.source_truncated) {
				throw new Error('Lesson text exceeds the native reading bound; readiness cannot be verified across the whole Document. Choose a narrower Document or read the source file.');
			}

			if (page?.match_count === 1 && (!baseline || noChangeRequired || page.version !== baseline.version)) {
				return {...page, readiness_verified: true};
			}

			await this.pause();
		}
	}
	/* eslint-enable no-await-in-loop */
}

export async function runCourse(runtime: PokemonRuntime, input: unknown, signal?: AbortSignal): Promise<CallToolResult> {
	const args = courseSchema.parse(input);
	return runtime.computerBatch(async (perform) => {
		const run = new CourseRun(runtime, args, perform, signal);
		try {
			const result = await run.run();
			return courseResult({
				ok: true, action: args.action, window_id: args.window_id, document_name: args.document_name,
				input_state: run.input, native_calls: run.calls, ...result,
			}, args.max_chars);
		} catch (error) {
			return courseResult({
				ok: false, action: args.action, phase: run.phase, input_state: run.input,
				native_calls: run.calls, error: (error instanceof Error ? error.message : String(error)).slice(0, 400),
			}, args.max_chars);
		}
	}, signal);
}
