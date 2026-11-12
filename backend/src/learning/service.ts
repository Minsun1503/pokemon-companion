import {createHash, randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {windowsStepSchema, validateWindowsBatchSteps, type WindowsStep} from '../windows/batch.js';
import {
	features, predict, similarity, train, type LocalModel, type Vector,
} from './model.js';
import {LocalJournal, redact, type KeyProtector} from './privacy.js';

export const parametersSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), z.string().max(1000)).refine((value) => Object.keys(value).length <= 16);
export type Parameters = z.infer<typeof parametersSchema>;
export type Satisfaction = 'satisfied' | 'unsatisfied' | 'unknown';
type Receipt = {tool: string; action: string; ok: boolean; duration_ms: number; apis: {name: string; ok: boolean; delivery: string}[]; error_code?: string};
type Task = {id: string; at: number; query: string; parameters: Parameters; calls: Receipt[]; closed: boolean;
	outcome: 'met' | 'unmet' | 'unknown'; satisfaction: Satisfaction; feedback_source?: string; summary?: string;
	plan?: WindowsStep[]; recipe_id?: string; trained_label?: 0 | 1;};
type Recipe = {id: string; at: number; kind: 'windows' | 'guide'; apis: string[]; steps: WindowsStep[]; parameters: string[]; vector: Vector; contexts: Vector[]; model: LocalModel; successes: number; failures: number};
type ApiCount = {successes: number; failures: number};
type State = {version: 1; enabled: boolean; retention_days: number; tasks: Record<string, Task>; recipes: Record<string, Recipe>; api_counts: Record<string, ApiCount>};
type Event = {kind: 'begin'; task: Task} | {kind: 'call'; id: string; receipt: Receipt; plan?: WindowsStep[]; invalidate_plan?: boolean}
	| {kind: 'use'; id: string; recipe_id: string}
	| {kind: 'finish'; id: string; outcome: Task['outcome']; summary: string}
	| {kind: 'feedback'; id: string; satisfaction: Satisfaction; source: string}
	| {kind: 'config'; enabled: boolean; retention_days: number} | {kind: 'snapshot'; state: State};

const fresh = (): State => ({
	version: 1, enabled: true, retention_days: 30, tasks: {}, recipes: {}, api_counts: {},
});
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const token = (name: string) => `{{parameter:${name}}}`;
const hasNativeRef = (step: WindowsStep) => ['window_id', 'window_ref', 'snapshot', 'element_id', 'ref', 'root_snapshot', 'root_element_id'].some((key) => Object.hasOwn(step, key));

export function reusablePlan(input: unknown, parameters: Parameters): WindowsStep[] | undefined {
	const parsed = windowsStepSchema.array().min(1).max(16).safeParse(input);
	if (!parsed.success) {
		return undefined;
	}

	const steps = parsed.data;
	if (steps.some((step) => hasNativeRef(step) || step.action === 'launch' || step.action === 'read_text')
		|| steps[0]?.action !== 'get_windows' || !steps[0].query
		|| !['get_ui', 'wait_for'].includes(steps.at(-1)!.action) || steps.at(-1)!.expect_value === undefined) {
		return undefined;
	}

	for (const [index, step] of steps.entries()) {
		if (step.window_step !== undefined && (step.window_step >= index || !['get_windows', 'get_ui', 'wait_for'].includes(steps[step.window_step]!.action))) {
			return undefined;
		}

		if (step.target_step !== undefined && (step.target_step >= index || !['get_ui', 'wait_for'].includes(steps[step.target_step]!.action))) {
			return undefined;
		}

		for (const field of ['text', 'query', 'expect_value'] as const) {
			const value = step[field];
			if (value === undefined) {
				continue;
			}

			if (value.includes('{{parameter:') || value.includes('[REDACTED]') || redact(value) !== value || value.length > 1000) {
				return undefined;
			}

			const bindings = Object.entries(parameters).filter(([, parameter]) => parameter === value);
			if (bindings.length > 1) {
				return undefined;
			}

			const binding = bindings[0];
			if (binding) {
				step[field] = token(binding[0]);
			} else if (field === 'text') {
				// Every entered value needs a current-task parameter, never a saved literal.
				return undefined;
			}
		}
	}

	try {
		validateWindowsBatchSteps(steps);
		return steps;
	} catch {
		return undefined;
	}
}

export class LocalLearning {
	private state = fresh();
	private loaded?: Promise<void>;
	private readonly journal: LocalJournal;
	private readonly previews = new Map<string, {task_id: string; recipe_id: string; steps: WindowsStep[]; expires: number}>();
	private recordingError?: string;
	private lastInferenceMs = 0;
	private readonly traces = new Map<string, {steps: WindowsStep[]; windows: Map<string, number>; controls: Map<string, number>; blocked: boolean}>();
	private readonly inflight = new Map<string, number>();
	private writes: Promise<void> = Promise.resolve();
	private refreshedAt = 0;
	constructor(directory = process.env.POKEMON_LEARNING_DIR || join(process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'), 'pokemon-companion', 'learning'), testKey?: Buffer, keyProtector?: KeyProtector) {
		this.journal = new LocalJournal(directory, testKey, keyProtector);
	}

	async open(): Promise<void> {
		this.loaded ||= (async () => {
			const events = await this.journal.load();
			for (const event of events) {
				this.apply(event as Event);
			}

			if (this.prune()) {
				await this.journal.replace({kind: 'snapshot', state: this.state});
			}
		})();
		await this.loaded;
		await this.writes;
		if (Date.now() - this.refreshedAt >= 60_000) {
			this.refreshedAt = Date.now();
			if (this.prune()) {
				await this.journal.replace({kind: 'snapshot', state: this.state});
			}
		}
	}

	async begin(query: string, parameters: Parameters): Promise<Task> {
		await this.open();
		if (!this.state.enabled || process.env.POKEMON_LEARNING === 'off') {
			throw new Error('Local learning is disabled.');
		}

		const task: Task = {
			id: randomUUID(), at: Date.now(), query: redact(query),
			parameters: Object.fromEntries(Object.entries(parameters).map(([name, value]) => [name, /password|secret|token|api_key|credential/i.test(name) ? '[REDACTED]' : redact(value)])), calls: [],
			closed: false, outcome: 'unknown', satisfaction: 'unknown',
		};
		await this.save({kind: 'begin', task});
		return structuredClone(task);
	}

	async enter(id: string): Promise<void> {
		await this.requireTask(id);
		this.inflight.set(id, (this.inflight.get(id) ?? 0) + 1);
	}

	leave(id: string): void {
		const remaining = (this.inflight.get(id) ?? 1) - 1;
		if (remaining > 0) {
			this.inflight.set(id, remaining);
		} else {
			this.inflight.delete(id);
		}
	}

	async requireTask(id: string): Promise<void> {
		await this.open();
		if (!this.state.tasks[id] || this.state.tasks[id].closed) {
			throw new Error('Learning task is missing or closed; begin a current task before sending input.');
		}
	}

	async record(id: string, tool: string, args: Record<string, unknown>, result: CallToolResult, elapsed: number): Promise<void> {
		try {
			await this.open();
			if (!this.state.enabled || process.env.POKEMON_LEARNING === 'off') {
				return;
			}

			const task = this.state.tasks[id];
			if (!task || task.closed) {
				return;
			}

			let data: Record<string, unknown> = {};
			try {
				data = JSON.parse(result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n')) as Record<string, unknown>;
			} catch {/* No screenshots or free-form app text are persisted. */}

			const ok = result.isError !== true && data.ok !== false;
			const action = typeof args.action === 'string' ? args.action : Array.isArray(args.steps) ? 'batch' : 'unknown';
			const steps = Array.isArray(args.steps) ? args.steps as {action: string}[] : undefined;
			const completed = typeof data.completed === 'number' ? data.completed : ok ? (steps?.length ?? 1) : 0;
			const error = data.error_details as {code?: string; disposition?: {delivery?: string}} | undefined;
			const apis = steps && typeof data.completed === 'number'
				? steps.slice(0, completed + (ok ? 0 : 1)).map((step, index) => ({
					name: `${tool}.${step.action}`,
					ok: index < completed, delivery: index < completed ? 'completed' : error?.disposition?.delivery ?? 'unknown',
				}))
				: [{name: `${tool}.${action}`, ok, delivery: ok ? 'completed' : error?.disposition?.delivery ?? 'unknown'}];
			const receipt: Receipt = {
				tool, action, ok, duration_ms: elapsed, apis, ...(error?.code ? {error_code: error.code} : {}),
			};
			const plan = this.capture(task, tool, args, data, ok);
			await this.save({
				kind: 'call', id, receipt, ...(plan ? {plan} : {}), invalidate_plan: !['desktop', 'pokemon'].includes(tool),
			});
		} catch (error) {
			// Logging failure never changes the reported delivery of an already applied action.
			this.recordingError = error instanceof Error ? error.message : 'Learning record failed.';
		}
	}

	async finish(id: string, outcome: Task['outcome'], summary: string): Promise<void> {
		await this.requireTask(id);
		if (this.inflight.has(id)) {
			throw new Error('A task tool call is still running; wait for its delivery result before finishing.');
		}

		await this.save({
			kind: 'finish', id, outcome, summary: redact(summary),
		});
		this.traces.delete(id);
	}

	async feedback(id: string, satisfaction: Satisfaction, source: 'user_ui' | 'explicit_user_report'): Promise<void> {
		await this.open();
		if (!this.state.tasks[id]?.closed) {
			throw new Error('Finish the task before recording user feedback.');
		}

		await this.save({
			kind: 'feedback', id, satisfaction, source,
		});
	}

	async suggest(query: string): Promise<unknown[]> {
		await this.open();
		if (!this.state.enabled || process.env.POKEMON_LEARNING === 'off') {
			this.lastInferenceMs = 0;
			return [];
		}

		const start = performance.now();
		const vector = features(query);
		const keys = Object.keys(vector);
		const suggestions = Object.values(this.state.recipes)
			.filter((recipe) => recipe.successes > recipe.failures)
			.map((recipe) => ({recipe, match: Math.max(...(recipe.contexts ?? [recipe.vector]).map((context) => similarity(vector, context, keys)))}))
			.filter((item) => item.match >= 0.65)
			.map((item) => ({...item, prediction: predict(item.recipe.model, vector, keys)}))
			.sort((a, b) => (b.match + (b.prediction * 0.2)) - (a.match + (a.prediction * 0.2))).slice(0, 3)
			.map(({recipe, match, prediction}) => ({
				recipe_id: recipe.id, match_score: match, model_score: prediction,
				successes: recipe.successes, failures: recipe.failures, parameters: recipe.parameters, steps: recipe.steps, kind: recipe.kind, apis: recipe.apis,
				requires_current_intent: true, requires_fresh_discovery: true,
			}));
		this.lastInferenceMs = performance.now() - start;
		return suggestions;
	}

	async preview(taskId: string, recipeId: string, parameters: Parameters): Promise<{preview_id: string; steps: WindowsStep[]}> {
		await this.requireTask(taskId);
		const recipe = this.state.recipes[recipeId];
		const vector = features(this.state.tasks[taskId]!.query);
		const keys = Object.keys(vector);
		if (!this.state.enabled || process.env.POKEMON_LEARNING === 'off' || recipe?.kind !== 'windows' || recipe.failures >= recipe.successes
			|| Math.max(...(recipe.contexts ?? [recipe.vector]).map((context) => similarity(vector, context, keys))) < 0.65) {
			throw new Error('Recipe is missing, unreliable, or does not match this current request.');
		}

		if (recipe.parameters.some((name) => !Object.hasOwn(parameters, name)) || Object.keys(parameters).some((name) => !recipe.parameters.includes(name))) {
			throw new Error('Supply exactly the current parameters required by this recipe.');
		}

		const steps = structuredClone(recipe.steps);
		for (const step of steps) {
			for (const field of ['text', 'query', 'expect_value'] as const) {
				const match = /^\{\{parameter:([a-z][a-z0-9_]*)\}\}$/.exec(step[field] ?? '');
				if (match) {
					step[field] = parameters[match[1]!]!;
				}
			}
		}

		windowsStepSchema.array().min(1).max(16).parse(steps);
		if (steps.some(hasNativeRef)) {
			throw new Error('A reusable recipe cannot contain native references.');
		}

		validateWindowsBatchSteps(steps);

		for (const [id, preview] of this.previews) {
			if (preview.expires <= Date.now()) {
				this.previews.delete(id);
			}
		}

		if (this.previews.size >= 32) {
			throw new Error('Too many pending learning previews.');
		}

		const preview_id = randomUUID();
		this.previews.set(preview_id, {
			task_id: taskId, recipe_id: recipeId, steps, expires: Date.now() + 120_000,
		});
		return {preview_id, steps: structuredClone(steps)};
	}

	async consume(taskId: string, previewId: string): Promise<WindowsStep[]> {
		await this.requireTask(taskId);
		const preview = this.previews.get(previewId);
		if (!this.state.enabled || process.env.POKEMON_LEARNING === 'off' || preview?.task_id !== taskId || preview.expires <= Date.now()) {
			throw new Error('Preview expired or belongs to another task. Preview the current plan again.');
		}

		this.previews.delete(previewId);
		await this.save({kind: 'use', id: taskId, recipe_id: preview.recipe_id});
		return structuredClone(preview.steps);
	}

	async useGuide(taskId: string, recipeId: string): Promise<Record<string, unknown>> {
		await this.requireTask(taskId);
		const recipe = this.state.recipes[recipeId];
		const vector = features(this.state.tasks[taskId]!.query);
		const keys = Object.keys(vector);
		if (!this.state.enabled || process.env.POKEMON_LEARNING === 'off' || recipe?.kind !== 'guide' || recipe.successes <= recipe.failures
			|| !(recipe.contexts ?? [recipe.vector]).some((context) => similarity(vector, context, keys) >= 0.65)) {
			throw new Error('No reliable process guide matches this task.');
		}

		await this.save({kind: 'use', id: taskId, recipe_id: recipeId});
		return {
			recipe_id: recipeId, apis: recipe.apis, execution_mode: 'current_task_tools', requires_current_intent: true, requires_fresh_discovery: true,
		};
	}

	async configure(enabled: boolean, retentionDays: number): Promise<void> {
		await this.save({kind: 'config', enabled, retention_days: retentionDays});
		if (!enabled) {
			this.previews.clear();
		}
	}

	async forget(): Promise<void> {
		await this.open();
		if (this.inflight.size > 0) {
			throw new Error('Wait for task tools to finish before erasing their records.');
		}

		const operation = this.writes.then(async () => {
			const empty = {...fresh(), enabled: this.state.enabled, retention_days: this.state.retention_days};
			await this.journal.replace({kind: 'snapshot', state: empty});
			this.state = empty;
			this.previews.clear();
			this.traces.clear();
		});
		this.writes = operation.catch(() => undefined);
		await operation;
	}

	async stats() {
		await this.open();
		return {
			enabled: this.state.enabled && process.env.POKEMON_LEARNING !== 'off', retention_days: this.state.retention_days, tasks: Object.keys(this.state.tasks).length,
			recipes: Object.keys(this.state.recipes).length, api_counts: this.state.api_counts, recording_error: this.recordingError ?? null,
			model: {
				family: 'online_logistic_workflow_ranker', features: 2048, gpu: false, background_training: false,
				examples: Object.values(this.state.recipes).reduce((sum, recipe) => sum + recipe.model.examples, 0), last_inference_ms: this.lastInferenceMs,
			},
			security: {
				encryption: 'AES-256-GCM', key_protection: process.platform === 'win32' ? 'DPAPI-current-user' : 'owner-only-file', uploads: false, screenshot_collection: false,
			},
			state_bytes: Buffer.byteLength(JSON.stringify(this.state)), directory: this.journal.directory,
		};
	}

	async export(): Promise<unknown> {
		await this.open();
		return structuredClone(this.state);
	}

	async exportPage(offset: number, maxChars: number, version?: string): Promise<Record<string, unknown>> {
		await this.open();
		const serialized = JSON.stringify(this.state);
		const currentVersion = digest(this.state);
		if ((offset > 0 && version !== currentVersion) || (version && version !== currentVersion)) {
			throw new Error('Export changed; restart at offset 0 with the new version.');
		}

		if (offset > serialized.length) {
			throw new Error('Export offset exceeds the record length.');
		}

		let size = Math.min(maxChars - 256, serialized.length - offset);
		let page: Record<string, unknown>;
		do {
			// Never split a UTF-16 surrogate pair across pages.
			if (size > 0 && /[\uD800-\uDBFF]/.test(serialized.charAt(offset + size - 1))) {
				size -= 1;
			}

			page = {
				format: 'json_chunks', version: currentVersion, total_chars: serialized.length, offset,
				next_offset: offset + size < serialized.length ? offset + size : null, data: serialized.slice(offset, offset + size),
			};
			if (JSON.stringify(page).length <= maxChars) {
				return page;
			}

			size = Math.floor(size * 0.8);
		} while (size > 0);

		throw new Error('Export page budget is too small.');
	}

	async close(): Promise<void> {
		this.previews.clear();
		this.traces.clear();
		if (this.loaded) {
			await this.loaded.catch(() => undefined);
			await this.writes;
			await this.journal.close();
		}
	}

	private apply(event: Event): void {
		if (!event || !['begin', 'call', 'finish', 'feedback', 'config', 'snapshot', 'use'].includes(event.kind)) {
			throw new Error('Unsupported learning journal record.');
		}

		if (event.kind === 'snapshot') {
			if (event.state.version !== 1) {
				throw new Error('Unsupported learning snapshot version.');
			}

			this.state = event.state;
		} else if (event.kind === 'begin') {
			this.state.tasks[event.task.id] = event.task;
		} else if (event.kind === 'config') {
			this.state.enabled = event.enabled;
			this.state.retention_days = event.retention_days;
		} else {
			const task = this.state.tasks[event.id];
			if (!task) {
				return;
			}

			if (event.kind === 'call') {
				task.calls.push(event.receipt);
				task.calls = task.calls.slice(-64);
				for (const api of event.receipt.apis) {
					this.state.api_counts[api.name] ||= {successes: 0, failures: 0};
					const count = this.state.api_counts[api.name]!;
					if (api.ok) {
						count.successes += 1;
					} else {
						count.failures += 1;
					}
				}

				if (event.plan) {
					task.plan = event.plan;
				} else if (event.invalidate_plan) {
					delete task.plan;
				}
			} else if (event.kind === 'use') {
				task.recipe_id = event.recipe_id;
			} else if (event.kind === 'finish') {
				task.closed = true;
				task.outcome = event.outcome;
				task.summary = event.summary;
			} else {
				task.satisfaction = event.satisfaction;
				task.feedback_source = event.source;
			}

			this.learn(task);
		}
	}

	private learn(task: Task): void {
		if (!task.closed) {
			return;
		}

		const positive = task.outcome === 'met' && task.satisfaction === 'satisfied' && task.calls.every((call) => call.ok);
		const negative = task.outcome === 'unmet' || task.satisfaction === 'unsatisfied' || task.calls.some((call) => !call.ok);
		if (!positive && !negative) {
			return;
		}

		const label = positive ? 1 : 0;
		if (task.trained_label === label) {
			return;
		}

		if (positive && !task.recipe_id) {
			const apis = task.calls.flatMap((call) => call.apis.map((api) => api.name));
			if (apis.length === 0) {
				return;
			}

			const id = digest(task.plan ?? apis).slice(0, 32);
			task.recipe_id = id;
			this.state.recipes[id] ||= {
				id, at: task.at, kind: task.plan ? 'windows' : 'guide', apis, steps: task.plan ?? [],
				parameters: [...new Set(JSON.stringify(task.plan ?? []).match(/\{\{parameter:([a-z][a-z0-9_]*)\}\}/g) ?? [])].map((value) => value.slice(12, -2)),
				vector: features(task.query), contexts: [features(task.query)], model: {weights: {}, bias: 0, examples: 0}, successes: 0, failures: 0,
			};
		}

		const recipe = task.recipe_id ? this.state.recipes[task.recipe_id] : undefined;
		if (recipe) {
			const context = features(task.query);
			train(recipe.model, context, label);
			if (positive && !(recipe.contexts ?? [recipe.vector]).some((vector) => similarity(vector, context) > 0.999)) {
				recipe.contexts = [...(recipe.contexts ?? [recipe.vector]), context].slice(-8);
			}

			recipe.at = Math.max(recipe.at, task.at);
			if (task.trained_label === 1) {
				recipe.successes -= 1;
			} else if (task.trained_label === 0) {
				recipe.failures -= 1;
			}

			if (positive) {
				recipe.successes += 1;
			} else {
				recipe.failures += 1;
			}
		}

		task.trained_label = label;
	}

	private prune(): boolean {
		let changed = false;
		const cutoff = Date.now() - (this.state.retention_days * 86_400_000);
		for (const group of [this.state.tasks, this.state.recipes]) {
			const ids = Object.keys(group).sort((first, second) => group[second]!.at - group[first]!.at);
			for (const [index, id] of ids.entries()) {
				if (group[id]!.at < cutoff || index >= 32) {
					Reflect.deleteProperty(group, id);
					changed = true;
				}
			}
		}

		for (const id of this.traces.keys()) {
			if (!this.state.tasks[id]) {
				this.traces.delete(id);
			}
		}

		for (const [id, preview] of this.previews) {
			if (preview.expires <= Date.now() || !this.state.tasks[preview.task_id] || !this.state.recipes[preview.recipe_id]) {
				this.previews.delete(id);
			}
		}

		while (Buffer.byteLength(JSON.stringify(this.state)) > 2 * 1024 * 1024) {
			const tasks = Object.keys(this.state.tasks).sort((a, b) => this.state.tasks[a]!.at - this.state.tasks[b]!.at);
			const recipes = Object.keys(this.state.recipes).sort((a, b) => this.state.recipes[a]!.at - this.state.recipes[b]!.at);
			if (tasks.length > 1) {
				Reflect.deleteProperty(this.state.tasks, tasks[0]!);
			} else if (recipes.length > 1) {
				Reflect.deleteProperty(this.state.recipes, recipes[0]!);
			} else {
				throw new Error('Learning state exceeded its memory budget.');
			}

			changed = true;
		}

		return changed;
	}

	private async save(event: Event): Promise<void> {
		await this.open();
		const operation = this.writes.then(async () => {
			await this.journal.append(event, {kind: 'snapshot', state: this.state});
			this.apply(event);
			if (this.prune()) {
				await this.journal.replace({kind: 'snapshot', state: this.state});
			}
		});
		this.writes = operation.catch(() => undefined);
		return operation;
	}

	private capture(task: Task, tool: string, args: Record<string, unknown>, data: Record<string, unknown>, ok: boolean): WindowsStep[] | undefined {
		if (['desktop', 'pokemon'].includes(tool)) {
			return task.plan;
		}

		let trace = this.traces.get(task.id);
		if (!trace) {
			trace = {
				steps: [], windows: new Map(), controls: new Map(), blocked: false,
			};
			this.traces.set(task.id, trace);
		}

		if (trace.blocked || tool !== 'windows' || !ok || trace.steps.length >= 16) {
			trace.blocked = true;
			return undefined;
		}

		if (Array.isArray(args.steps)) {
			const parsed = windowsStepSchema.array().safeParse(args.steps);
			if (!parsed.success || parsed.data.some(hasNativeRef)) {
				trace.blocked = true;
				return undefined;
			}

			const offset = trace.steps.length;
			for (const step of parsed.data) {
				trace.steps.push({
					...step, ...(step.window_step !== undefined ? {window_step: step.window_step + offset} : {}),
					...(step.target_step !== undefined ? {target_step: step.target_step + offset} : {}),
				});
			}
		} else {
			const parsed = windowsStepSchema.safeParse(args);
			if (!parsed.success) {
				trace.blocked = true;
				return undefined;
			}

			const step = parsed.data;
			const index = trace.steps.length;
			if (step.action === 'get_windows') {
				const windows = data.windows as {id: string}[] | undefined;
				if (data.truncated || windows?.length !== 1 || !step.query) {
					trace.blocked = true;
					return undefined;
				}

				trace.windows.set(windows[0]!.id, index);
			} else if (step.window_id) {
				const source = trace.windows.get(step.window_id);
				if (source === undefined) {
					trace.blocked = true;
					return undefined;
				}

				step.window_step = source;
				delete step.window_id;
				delete step.window_ref;
			}

			if (step.ref) {
				const ref = /^@?s([a-f0-9]{32}):e?([1-9]\d*)$/.exec(step.ref);
				step.snapshot = ref?.[1];
				step.element_id = Number(ref?.[2]);
				delete step.ref;
			}

			if (step.snapshot && step.element_id) {
				const source = trace.controls.get(`${step.snapshot}:${step.element_id}`);
				if (source === undefined) {
					trace.blocked = true;
					return undefined;
				}

				step.target_step = source;
				delete step.snapshot;
				delete step.element_id;
			}

			if (['get_ui', 'wait_for'].includes(step.action)) {
				const nodes = data.nodes as {id: number; value?: string; value_clipped?: boolean}[] | undefined;
				if (!data.truncated && data.matched === 1 && nodes?.length === 1 && typeof data.snapshot === 'string') {
					trace.controls.set(`${data.snapshot}:${nodes[0]!.id}`, index);
					const entered = [...trace.steps].reverse().find((previous) => previous.action === 'set_value');
					if (step.action === 'get_ui' && entered?.text !== undefined && nodes[0]!.value === entered.text && !nodes[0]!.value_clipped) {
						step.expect_value = entered.text;
					}
				}
			}

			trace.steps.push(step);
		}

		return reusablePlan(trace.steps, task.parameters);
	}
}
