import {z} from 'zod';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import {registerWindows} from '../tools/windows.js';
import {registerDesktop} from '../tools/desktop.js';
import {registerComputer} from '../tools/computer.js';
import {registerExcel} from '../tools/excel.js';
import {registerCourse} from '../tools/course.js';
import {windowsActions} from '../windows/actions.js';

type Registered = {schema: z.ZodType; description: string; handler(args: unknown, extra: {signal: AbortSignal}): Promise<CallToolResult>};
type ControlTarget = {time: number; window_id: string; window_ref: string; snapshot: string; element_id: number; actions: string[]};
type View = {query?: string | undefined; control_type?: string | undefined};
const handoffSchema = z.object({reason: z.string().min(1).max(1000)}).strict();
const doneSchema = z.object({
	window_id: z.string(), window_ref: z.string(), query: z.string().min(1).max(200).describe('Name of an observed result control, e.g. a person’s name. This filters control names, not search field values. Do not use with:/from: search text.'),
	summary: z.string().min(1).max(2000),
}).strict();
// This model consumes text. Native controls work without screenshot interpretation.
const keyboardSchema = z.object({
	action: z.enum(['key', 'type']), text: z.string().min(1).max(8000),
	window_id: z.string().regex(/^\d+$/), window_ref: z.string().regex(/^[a-f0-9]{32}$/),
}).strict();
// Keep the model-facing contract small. Execution still uses the original MCP schema/handler.
const windowsSchema = z.object({
	action: z.enum(windowsActions),
	target: z.string().optional().describe('For control actions copy a short target from get_ui, e.g. c1. It supplies the exact window and snapshot; no other IDs are needed.'),
	text: z.string().max(8000).optional().describe('Required for launch: executable path/name or http/https URL. Required for set_value: field content.'),
	query: z.string().max(200).optional().describe('Filter for window/control discovery. It is not the app executable or the text to type.'),
	window_id: z.string().optional().describe('Copy id from get_windows for every window/control action.'),
	window_ref: z.string().optional().describe('Copy window_ref from get_windows with window_id.'),
	snapshot: z.string().optional().describe('Copy snapshot from get_ui for element input.'),
	element_id: z.number().int().optional().describe('Copy the chosen node id from get_ui for element input.'),
	ref: z.string().optional(), control_type: z.string().optional(),
	direction: z.enum(['up', 'down', 'left', 'right']).optional(),
	expect_value: z.string().max(160).optional(),
	wait_condition: z.enum(['present', 'absent', 'enabled', 'disabled', 'selected', 'unselected']).optional(),
	timeout_ms: z.number().int().min(1).max(15000).optional(),
	max_chars: z.number().int().min(1000).max(16000).optional(),
}).strict();

function unpack(result: CallToolResult): Record<string, unknown> {
	const text = result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n');
	try {
		return JSON.parse(text) as Record<string, unknown>;
	} catch {
		return {text};
	}
}

/** The same Pokémon MCP handlers, called locally by the Kaggle tool loop. */
export class TalkTools {
	private readonly registered = new Map<string, Registered>();
	private readonly requests = new Map<string, string>();
	private readonly observedWindows = new Map<string, Set<string>>();
	private readonly targets = new Map<string, Map<string, ControlTarget>>();
	private readonly views = new Map<string, Map<string, View>>();
	private targetSequence = 0;

	constructor(private readonly runtime: PokemonRuntime) {
		const collector = {
			registerTool: (name: string, config: {inputSchema: z.ZodType; description: string}, handler: Registered['handler']) => {
				this.registered.set(name, {schema: config.inputSchema, description: config.description, handler});
			},
		} as unknown as McpServer;
		registerDesktop(collector, runtime);
		registerWindows(collector, runtime);
		registerComputer(collector, runtime);
		registerExcel(collector, runtime);
		registerCourse(collector, runtime);
	}

	begin(pet: string, text: string): void {
		this.requests.set(pet, text);
		this.observedWindows.set(pet, new Set());
		this.targets.set(pet, new Map());
		this.views.set(pet, new Map());
	}

	list(pet: string): unknown[] {
		const request = (this.requests.get(pet) || '').normalize('NFD').replace(/\p{M}/gu, '');
		const entries = [...this.registered].filter(([name]) =>
			(name !== 'excel' || /excel|workbook|spreadsheet|bang tinh/i.test(request))
			&& (name !== 'course' || /course|lesson|learning|khoa hoc|bai hoc/i.test(request)));
		return [
			...entries.map(([name, tool]) => ({
				name, description: name === 'computer'
					? 'Keyboard fallback: key presses a direct shortcut (text="ctrl+e" or "Return"), type enters literal text. Requires freshly discovered foreground window_id/window_ref. Prefer windows set_value/focus/invoke. Verify with windows get_ui afterward. This model cannot interpret screenshots; never guess coordinates.'
					: name === 'windows'
						? 'Pokémon native Windows controls. get_windows finds apps. activate opens an existing window using window_id/window_ref. get_ui reads controls; query="Search" finds search boxes. Control actions need only action and the short target from get_ui: {action:"set_value",target:"c1",text:"Damien"}, {action:"focus",target:"c1"}, {action:"invoke",target:"c2"}. select chooses an item. launch needs text=executable or URL. Use keyboard Return after focusing a search if needed. Re-read after actions. Never invent targets.'
						: tool.description, schema: name === 'computer' ? keyboardSchema : name === 'windows' ? windowsSchema : tool.schema,
			})),
			{name: 'human_handoff', description: 'Stop with an exact instruction when the task needs a password, CAPTCHA, final authorization, user decision, or an inaccessible control. Give the actual obstacle, not a promise.', schema: handoffSchema},
			{name: 'task_done', description: 'Finish only after all requested steps are complete. Supply the observed window and query naming a result control (not merely the typed search field). Re-reads actual UI to verify the evidence. summary is the final reply in the user’s language.', schema: doneSchema},
		].map(({name, description, schema}) => ({type: 'function', function: {name, description, parameters: z.toJSONSchema(schema)}}));
	}

	async call(name: string, args: unknown, pet: string): Promise<unknown> {
		if (this.runtime.companion.state.paused && name !== 'desktop') {
			return {paused: true};
		}

		if (name === 'human_handoff') {
			return {handoff: handoffSchema.parse(args).reason};
		}

		if (name === 'task_done') {
			const input = doneSchema.parse(args);
			if (!this.observedWindows.get(pet)?.has(`${input.window_id}:${input.window_ref}`)) {
				throw new Error('Read this app with windows get_ui first. No observed result exists for this task.');
			}

			const result = await this.invoke('windows', {
				action: 'get_ui', window_id: input.window_id, window_ref: input.window_ref, query: input.query, max_chars: 6000,
			});
			const data = unpack(result);
			const nodes = data.nodes as {role?: string; value?: string; name?: string}[] | undefined;
			if (result.isError || data.ok === false || !nodes?.length || !nodes.some((node) => node.role !== 'Edit' && node.role !== 'ComboBox')) {
				return {error: 'The requested result is not visible. Continue inspecting/acting; typing a query alone does not complete a search.', evidence: data};
			}

			return {verified: true, summary: input.summary, evidence: data};
		}

		const input = name === 'computer' ? keyboardSchema.parse(args) : name === 'windows' ? this.resolveTarget(args, pet) : args;
		const result = await this.invoke(name, input);
		const data = unpack(result);
		if (result.isError || data.ok === false) {
			return {error: true, result: data};
		}

		this.observe(pet, data);
		if (name === 'windows') {
			const request = input as Record<string, unknown>;
			const windowKey = `${String(request.window_id)}:${String(request.window_ref)}`;
			if (request.action === 'get_ui') {
				const views = this.views.get(pet) || new Map<string, View>();
				views.set(windowKey, {query: request.query as string | undefined, control_type: request.control_type as string | undefined});
				this.views.set(pet, views);
			}

			if (['set_value', 'focus', 'invoke', 'select', 'toggle', 'expand', 'collapse', 'scroll'].includes(String(request.action))) {
				const view = this.views.get(pet)?.get(windowKey) || {};
				try {
					// Observe every input's result; never resend the input when this read fails.
					if (request.action === 'set_value' && typeof request.text === 'string' && request.text.length <= 160 && (view.query || view.control_type)) {
						await this.invoke('windows', {
							action: 'wait_for', window_id: request.window_id, window_ref: request.window_ref, ...view, expect_value: request.text, timeout_ms: 3000,
						});
					}

					const observed = await this.invoke('windows', {
						action: 'get_ui', window_id: request.window_id, window_ref: request.window_ref, ...view, max_chars: 8000,
					});
					const observation = unpack(observed);
					this.observe(pet, observation);
					return {action_result: data, observation, instruction: 'Use this fresh observation for the next step. Choose a result control, not the search input. Call task_done when the user’s requested result is visible.'};
				} catch (error) {
					return {action_result: data, observation_error: error instanceof Error ? error.message : String(error), instruction: 'The input was already sent. Inspect get_ui before any further input; do not blindly resend it.'};
				}
			}
		}

		return data;
	}

	private async invoke(name: string, args: unknown): Promise<CallToolResult> {
		const tool = this.registered.get(name);
		if (!tool) {
			throw new Error(`Unknown Pokémon desktop tool: ${name}`);
		}

		return tool.handler(tool.schema.parse(args), {signal: AbortSignal.timeout(30000)});
	}

	private resolveTarget(args: unknown, pet: string): unknown {
		if (!args || typeof args !== 'object' || !(args as Record<string, unknown>).target) {
			return args;
		}

		const input = {...args} as Record<string, unknown>;
		const target = this.targets.get(pet)?.get(String(input.target));
		if (!target || Date.now() - target.time > 120000) {
			throw new Error('Unknown or expired control target. Read get_ui again and use its returned target.');
		}

		if (!target.actions.includes(String(input.action))) {
			throw new Error('This observed target does not support that action. Inspect the available actions and choose a suitable control.');
		}

		if (input.ref !== undefined) {
			throw new Error('Use either target or ref, not both.');
		}

		for (const field of ['window_id', 'window_ref', 'snapshot', 'element_id'] as const) {
			if (input[field] !== undefined && input[field] !== target[field]) {
				throw new Error('The supplied IDs conflict with this observed target. Use only its target.');
			}

			input[field] = target[field];
		}

		delete input.target;
		return input;
	}

	private observe(pet: string, value: Record<string, unknown>): void {
		if (value.ok === false) {
			return;
		}

		const window = value.window as {id?: string; window_ref?: string} | undefined;
		if (typeof value.snapshot === 'string' && window?.id && window.window_ref && Array.isArray(value.nodes)) {
			const windows = this.observedWindows.get(pet) || new Set<string>();
			windows.add(`${window.id}:${window.window_ref}`);
			this.observedWindows.set(pet, windows);
			const targets = this.targets.get(pet) || new Map<string, ControlTarget>();
			for (const node of value.nodes as {id: number; targetable?: boolean; actions?: string[]; target?: string}[]) {
				if (!node.targetable || !node.actions?.length) {
					continue;
				}

				this.targetSequence += 1;
				node.target = `c${this.targetSequence}`;
				targets.set(node.target, {
					time: Date.now(), window_id: window.id, window_ref: window.window_ref, snapshot: value.snapshot, element_id: node.id, actions: node.actions,
				});
			}

			this.targets.set(pet, targets);
		}

		for (const item of Object.values(value)) {
			if (item && typeof item === 'object' && !Array.isArray(item)) {
				this.observe(pet, item as Record<string, unknown>);
			}
		}
	}
}
