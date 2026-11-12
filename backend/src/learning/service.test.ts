// Journal writes, workflow steps and export pages deliberately depend on prior results.
/* eslint-disable no-await-in-loop */
import {
	mkdtemp, readFile, rm, writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {
	afterEach, describe, expect, it, vi,
} from 'vitest';
import {LocalLearning, reusablePlan} from './service.js';
import {LocalJournal, redact} from './privacy.js';
import {
	features, normalizeQuery, predict, similarity, train,
} from './model.js';
import {windowsStepSchema} from '../windows/batch.js';
import {jsonResult} from '../utils/response.js';

const directories: string[] = [];
const opened: {close(): Promise<void>}[] = [];
async function temporary() {
	const directory = await mkdtemp(join(tmpdir(), 'pokemon-learning-test-'));
	directories.push(directory);
	return directory;
}

async function fixture() {
	const directory = await temporary();
	const key = randomBytes(32);
	const learning = new LocalLearning(directory, key);
	opened.push(learning);
	return {directory, key, learning};
}

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	await Promise.all(opened.splice(0).map(async (item) => item.close()));
	await Promise.all(directories.splice(0).map(async (directory) => rm(directory, {recursive: true, force: true})));
});

const plan = windowsStepSchema.array().parse([
	{action: 'get_windows', query: 'My fixture'},
	{
		action: 'get_ui', window_step: 0, query: 'Editable field', control_type: 'Edit',
	},
	{action: 'set_value', target_step: 1, text: 'Hello'},
	{
		action: 'get_ui', window_step: 0, query: 'Editable field', control_type: 'Edit', expect_value: 'Hello',
	},
]);
const parameters = {window: 'My fixture', text: 'Hello'};
const success = jsonResult({ok: true, completed: 4, result: {matched: 1, truncated: false}});

describe('efficient local model', () => {
	it('matches supported paraphrases and diacritics, with bounded normalized features', () => {
		expect(normalizeQuery('Mở browser')).toBe('open browser');
		expect(similarity(features('Start browser'), features('Open browser'))).toBeCloseTo(1);
		expect(Object.keys(features('a'.repeat(20_000))).length).toBeLessThanOrEqual(2048);
	});
	it('actually updates its prediction from positive and negative feedback', () => {
		const vector = features('Fill the note');
		const model = {weights: {}, bias: 0, examples: 0};
		train(model, vector, 1);
		const positive = predict(model, vector);
		expect(positive).toBeGreaterThan(0.5);
		train(model, vector, 0);
		expect(predict(model, vector)).toBeLessThan(positive);
		expect(model.examples).toBe(2);
	});
	it('keeps persisted sparse scores and feedback updates compatible', () => {
		const dot = (first: Record<string, number>, second: Record<string, number>) => Object.entries(first).reduce((sum, [key, value]) => sum + (value * (second[key] ?? 0)), 0);
		const score = (model: {weights: Record<string, number>; bias: number}, vector: Record<string, number>) => 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, model.bias + dot(model.weights, vector)))));
		const original: {weights: Record<string, number>; bias: number; examples: number} = {weights: {0: -0.3, 2047: 0.8}, bias: 0.2, examples: 4};
		const optimized = structuredClone(original);
		for (let index = 0; index < 256; index++) {
			const vector = features(index % 17 === 0 ? '' : `Type the field ${index} please`);
			const label = index % 3 === 0 ? 0 : 1;
			expect(similarity(vector, original.weights)).toBe(dot(vector, original.weights));
			expect(similarity(vector, original.weights, Object.keys(vector))).toBe(dot(vector, original.weights));
			expect(predict(optimized, vector)).toBe(score(original, vector));
			expect(predict(optimized, vector, Object.keys(vector))).toBe(score(original, vector));
			const gradient = (label - score(original, vector)) * 0.4;
			for (const [key, value] of Object.entries(vector)) {
				original.weights[key] = ((original.weights[key] ?? 0) * 0.999) + (gradient * value);
			}

			original.bias = Math.max(-4, Math.min(4, original.bias + gradient));
			original.examples += 1;
			train(optimized, vector, label);
			expect(optimized).toEqual(original);
		}

		const inherited = Object.assign(Object.create({7: 100}) as Record<string, number>, {1: 0.5});
		expect(similarity(inherited, {1: 2, 7: 1})).toBe(1);
	});
});

describe('local learning and secure reuse', () => {
	it('expires records and recipes while a long-lived service is open', async () => {
		const {learning} = await fixture();
		const now = Date.now();
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const task = await learning.begin('Type a note', parameters);
		await learning.record(task.id, 'windows', {steps: plan}, success, 1);
		await learning.finish(task.id, 'met', 'Observed');
		await learning.feedback(task.id, 'satisfied', 'explicit_user_report');
		vi.mocked(Date.now).mockReturnValue(now + (31 * 86_400_000));
		expect((await learning.stats()).tasks).toBe(0);
		expect(await learning.suggest(task.query)).toEqual([]);
		vi.restoreAllMocks();
	});
	it('rejects wrong-task and expired previews and exports reconstructible bounded pages', async () => {
		const {learning} = await fixture();
		const task = await learning.begin(`Type a note 😀 ${'"\\\n'.repeat(800)}`, parameters);
		await learning.record(task.id, 'windows', {steps: plan}, success, 1);
		await learning.finish(task.id, 'met', 'Observed');
		await learning.feedback(task.id, 'satisfied', 'explicit_user_report');
		const recipe = (await learning.suggest(task.query) as {recipe_id: string}[])[0]!;
		const next = await learning.begin(task.query, parameters);
		const other = await learning.begin(task.query, parameters);
		const preview = await learning.preview(next.id, recipe.recipe_id, parameters);
		await expect(learning.consume(other.id, preview.preview_id)).rejects.toThrow();
		vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_001);
		await expect(learning.consume(next.id, preview.preview_id)).rejects.toThrow();
		vi.restoreAllMocks();
		let offset = 0;
		let version: string | undefined;
		let serialized = '';
		do {
			const page = await learning.exportPage(offset, 1000, version) as {data: string; version: string; next_offset: number | null};
			expect(JSON.stringify(page).length).toBeLessThanOrEqual(1000);
			serialized += page.data;
			version = page.version;
			offset = page.next_offset ?? -1;
		} while (offset >= 0);

		expect(JSON.parse(serialized)).toEqual(await learning.export());
		await learning.begin('Changed task', {});
		await expect(learning.exportPage(100, 1000, version)).rejects.toThrow('changed');
	});
	it('serializes concurrent records and reopens with exactly-once API counts', async () => {
		const {directory, key, learning} = await fixture();
		const task = await learning.begin('Read windows', {});
		await Promise.all(Array.from({length: 40}, async () => learning.record(task.id, 'desktop', {action: 'status'}, jsonResult({ok: true}), 1)));
		expect((await learning.stats()).api_counts['desktop.status']?.successes).toBe(40);
		await learning.close();
		const restored = new LocalLearning(directory, key);
		opened.push(restored);
		expect((await restored.stats()).api_counts['desktop.status']?.successes).toBe(40);
	});
	it('learns a full atomic sequence without persisting its native identifiers', async () => {
		const {learning} = await fixture();
		const task = await learning.begin('Type a note', parameters);
		await learning.record(task.id, 'windows', {action: 'get_windows', query: 'My fixture'}, jsonResult({windows: [{id: '123'}], truncated: false}), 1);
		const snapshot = 'a'.repeat(32);
		const ui = {
			window: {id: '123'}, snapshot, matched: 1, truncated: false, nodes: [{
				id: 1, name: 'Editable field', value: '', actions: ['set_value'],
			}],
		};
		await learning.record(task.id, 'windows', {
			action: 'get_ui', window_id: '123', query: 'Editable field', control_type: 'Edit',
		}, jsonResult(ui), 1);
		await learning.record(task.id, 'windows', {
			action: 'set_value', snapshot, element_id: 1, text: 'Hello',
		}, jsonResult({ok: true}), 1);
		await learning.record(task.id, 'windows', {
			action: 'get_ui', window_id: '123', query: 'Editable field', control_type: 'Edit',
		}, jsonResult({...ui, nodes: [{...ui.nodes[0], value: 'Hello'}]}), 1);
		await learning.finish(task.id, 'met', 'Observed the note');
		await learning.feedback(task.id, 'satisfied', 'explicit_user_report');
		const suggestions = await learning.suggest(task.query) as {kind: string; steps: {target_step?: number}[]}[];
		expect(suggestions[0]!.kind).toBe('windows');
		expect(suggestions[0]!.steps[2]!.target_step).toBe(1);
		expect(JSON.stringify(await learning.export())).not.toContain(snapshot);
		expect(JSON.stringify(await learning.export())).not.toContain('window_id');
	});

	it('retains a mixed-tool process guide instead of silently replaying only one subtask', async () => {
		const {learning} = await fixture();
		const task = await learning.begin('Type and inspect the chart', parameters);
		await learning.record(task.id, 'windows', {steps: plan}, success, 1);
		await learning.record(task.id, 'computer', {action: 'get_screenshot'}, {content: [{type: 'image', data: 'PRIVATE', mimeType: 'image/png'}]}, 1);
		await learning.finish(task.id, 'met', 'Observed chart');
		await learning.feedback(task.id, 'satisfied', 'explicit_user_report');
		const suggestion = (await learning.suggest(task.query) as {recipe_id: string; kind: string; apis: string[]}[])[0]!;
		expect(suggestion.kind).toBe('guide');
		expect(suggestion.apis).toContain('computer.get_screenshot');
		const next = await learning.begin(task.query, parameters);
		expect((await learning.useGuide(next.id, suggestion.recipe_id)).execution_mode).toBe('current_task_tools');
		await expect(learning.preview(next.id, suggestion.recipe_id, parameters)).rejects.toThrow();
	});

	it('adapts retrieval to a new phrasing learned through another verified run', async () => {
		const {learning} = await fixture();
		for (const query of ['Type a note', 'Complete the editor entry']) {
			const task = await learning.begin(query, parameters);
			await learning.record(task.id, 'windows', {steps: plan}, success, 1);
			await learning.finish(task.id, 'met', 'Observed');
			await learning.feedback(task.id, 'satisfied', 'explicit_user_report');
		}

		expect(await learning.suggest('Complete the editor entry')).toHaveLength(1);
		expect((await learning.stats()).recipes).toBe(1);
		expect((await learning.stats()).model.examples).toBe(2);
	});

	it('prevents finish while input is in flight and invalidates previews when learning is disabled', async () => {
		const {learning} = await fixture();
		const task = await learning.begin('Type a note', parameters);
		await learning.enter(task.id);
		await expect(learning.finish(task.id, 'met', '')).rejects.toThrow('still running');
		learning.leave(task.id);
		await learning.record(task.id, 'windows', {steps: plan}, success, 1);
		await learning.finish(task.id, 'met', 'Observed');
		await learning.feedback(task.id, 'satisfied', 'explicit_user_report');
		const recipe = (await learning.suggest(task.query) as {recipe_id: string}[])[0]!;
		const next = await learning.begin(task.query, parameters);
		const preview = await learning.preview(next.id, recipe.recipe_id, parameters);
		await learning.configure(false, 30);
		await expect(learning.consume(next.id, preview.preview_id)).rejects.toThrow();
	});
	it('learns only after a completed task and explicit positive satisfaction, then binds new parameters', async () => {
		const {learning} = await fixture();
		const task = await learning.begin('Type a note in my fixture', parameters);
		await learning.record(task.id, 'windows', {steps: plan}, success, 3);
		expect(await learning.suggest(task.query)).toEqual([]);
		await learning.finish(task.id, 'met', 'Observed the requested note');
		expect(await learning.suggest(task.query)).toEqual([]);
		await learning.feedback(task.id, 'satisfied', 'explicit_user_report');
		const suggestions = await learning.suggest(task.query) as {recipe_id: string; parameters: string[]}[];
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]!.parameters).toEqual(['window', 'text']);
		const next = await learning.begin(task.query, {window: 'New fixture', text: 'Different note'});
		const preview = await learning.preview(next.id, suggestions[0]!.recipe_id, {window: 'New fixture', text: 'Different note'});
		expect(preview.steps[0]!.query).toBe('New fixture');
		expect(preview.steps[2]!.text).toBe('Different note');
		expect(preview.steps[3]!.expect_value).toBe('Different note');
		const used = await learning.consume(next.id, preview.preview_id);
		expect(used).toEqual(preview.steps);
		await expect(learning.consume(next.id, preview.preview_id)).rejects.toThrow('Preview');
	});

	it('persists learned weights, preserves unknown satisfaction, and stores no screenshot payload', async () => {
		const {directory, key, learning} = await fixture();
		const task = await learning.begin('Type a note', parameters);
		await learning.record(task.id, 'windows', {steps: plan}, success, 3);
		await learning.record(task.id, 'computer', {action: 'get_screenshot'}, {content: [{type: 'image', data: 'PRIVATE_SCREEN', mimeType: 'image/png'}]}, 2);
		await learning.finish(task.id, 'met', 'Observed');
		const before = await learning.export() as {tasks: Record<string, {satisfaction: string}>};
		expect(before.tasks[task.id]!.satisfaction).toBe('unknown');
		await learning.feedback(task.id, 'satisfied', 'explicit_user_report');
		const encrypted = await readFile(join(directory, 'events.enc'), 'utf8');
		expect(encrypted).not.toContain('Type a note');
		expect(encrypted).not.toContain('PRIVATE_SCREEN');
		await learning.close();
		const restored = new LocalLearning(directory, key);
		opened.push(restored);
		expect(await restored.suggest('Type a note')).toHaveLength(1);
		expect((await restored.stats()).model.examples).toBe(1);
		expect(JSON.stringify(await restored.export())).not.toContain('PRIVATE_SCREEN');
	});

	it('records partial batch failures at the stopped API and never learns a failed task', async () => {
		const {learning} = await fixture();
		const task = await learning.begin('Type a note', parameters);
		const failed = {
			...jsonResult({
				ok: false, completed: 2, stopped_step: 2, error_details: {code: 'STALE_REF', disposition: {delivery: 'not_delivered'}},
			}), isError: true,
		};
		await learning.record(task.id, 'windows', {steps: plan}, failed, 3);
		await learning.finish(task.id, 'unmet', 'The control changed');
		await learning.feedback(task.id, 'unsatisfied', 'explicit_user_report');
		const stats = await learning.stats();
		expect(stats.api_counts['windows.get_windows']).toEqual({successes: 1, failures: 0});
		expect(stats.api_counts['windows.set_value']).toEqual({successes: 0, failures: 1});
		expect(stats.api_counts['windows.get_ui']).toEqual({successes: 1, failures: 0});
		expect(await learning.suggest(task.query)).toEqual([]);
	});

	it('downgrades a learned recipe on explicit negative feedback and ignores duplicate ratings', async () => {
		const {learning} = await fixture();
		const task = await learning.begin('Type a note', parameters);
		await learning.record(task.id, 'windows', {steps: plan}, success, 3);
		await learning.finish(task.id, 'met', 'Observed');
		await learning.feedback(task.id, 'satisfied', 'explicit_user_report');
		await learning.feedback(task.id, 'satisfied', 'explicit_user_report');
		expect((await learning.stats()).model.examples).toBe(1);
		await learning.feedback(task.id, 'unsatisfied', 'explicit_user_report');
		expect(await learning.suggest(task.query)).toEqual([]);
	});

	it('rejects stale handles, saved input, shell launch and incomplete verification recipes', () => {
		expect(reusablePlan([{...plan[0], window_id: '123'}, ...plan.slice(1)], parameters)).toBeUndefined();
		expect(reusablePlan(plan, {})).toBeUndefined();
		expect(reusablePlan([{action: 'launch', text: 'cmd.exe'}, ...plan.slice(1)], parameters)).toBeUndefined();
		expect(reusablePlan(plan.slice(0, 3), parameters)).toBeUndefined();
		expect(reusablePlan(plan.map((step) => step.action === 'set_value' ? {...step, text: `sk-${'A'.repeat(30)}`} : step), parameters)).toBeUndefined();
	});

	it('disables collection, erases data/models, and rewrites the encrypted journal', async () => {
		const {learning} = await fixture();
		await learning.begin('Private test query', {});
		await learning.configure(false, 7);
		await expect(learning.begin('Another query', {})).rejects.toThrow('disabled');
		await learning.forget();
		expect((await learning.stats()).tasks).toBe(0);
		expect((await learning.stats()).enabled).toBe(false);
	});
	it('withholds existing suggestions while disabled and restores them when enabled', async () => {
		const {learning} = await fixture();
		const task = await learning.begin('Type a note', parameters);
		await learning.record(task.id, 'windows', {steps: plan}, success, 1);
		await learning.finish(task.id, 'met', 'Observed');
		await learning.feedback(task.id, 'satisfied', 'explicit_user_report');
		expect(await learning.suggest(task.query)).toHaveLength(1);
		await learning.configure(false, 30);
		expect(await learning.suggest(task.query)).toEqual([]);
		await learning.configure(true, 30);
		vi.stubEnv('POKEMON_LEARNING', 'off');
		try {
			expect(await learning.suggest(task.query)).toEqual([]);
		} finally {
			vi.unstubAllEnvs();
		}

		expect(await learning.suggest(task.query)).toHaveLength(1);
	});
});

describe('encryption and isolation', () => {
	it('compacts a full journal into a prior snapshot plus one new event', async () => {
		const directory = await temporary();
		const key = randomBytes(32);
		const journal = new LocalJournal(directory, key);
		opened.push(journal);
		await journal.load();
		for (let index = 0; index < 5; index++) {
			await journal.append({index, padding: 'x'.repeat(700_000)}, {kind: 'snapshot', count: index});
		}

		await journal.close();
		const restored = new LocalJournal(directory, key);
		opened.push(restored);
		const events = await restored.load() as {index?: number; count?: number}[];
		expect(events[0]?.count).toBe(4);
		expect(events.filter((event) => event.index === 4)).toHaveLength(1);
		expect(events).toHaveLength(2);
	});
	it('rejects oversized journals before decryption', async () => {
		const directory = await temporary();
		await writeFile(join(directory, 'events.enc'), Buffer.alloc((8 * 1024 * 1024) + 1));
		const journal = new LocalJournal(directory, randomBytes(32));
		opened.push(journal);
		await expect(journal.load()).rejects.toThrow('read limit');
	});
	it.runIf(process.platform === 'win32')('protects a real persisted key with Windows DPAPI and decrypts it after restart', async () => {
		const directory = await temporary();
		const learning = new LocalLearning(directory);
		opened.push(learning);
		await learning.begin('DPAPI persistence test', {});
		const key = await readFile(join(directory, 'key'));
		expect(key.length).toBeGreaterThan(32);
		await learning.close();
		const restored = new LocalLearning(directory);
		opened.push(restored);
		expect((await restored.stats()).tasks).toBe(1);
	}, 15_000);
	it('redacts recognizable credentials', () => {
		expect(redact(`api_key=supersecret Bearer abc.def ghp_${'a'.repeat(20)}`)).not.toContain('supersecret');
	});
	it('fails closed on tampered ciphertext and releases its writer lock', async () => {
		const directory = await temporary();
		const key = randomBytes(32);
		const journal = new LocalJournal(directory, key);
		opened.push(journal);
		await journal.load();
		await journal.append({private: 'hello'}, {});
		await journal.close();
		const path = join(directory, 'events.enc');
		const bytes = Buffer.from((await readFile(path, 'utf8')).trim(), 'base64');
		bytes[bytes.length - 1] = (bytes[bytes.length - 1]! + 1) % 256;
		await writeFile(path, `${bytes.toString('base64')}\n`);
		const restored = new LocalJournal(directory, key);
		opened.push(restored);
		await expect(restored.load()).rejects.toThrow();
		await expect(readFile(join(directory, 'writer.lock'))).rejects.toMatchObject({code: 'ENOENT'});
	});
	it('prevents two live writers from using one profile', async () => {
		const {directory, key, learning} = await fixture();
		await learning.open();
		const second = new LocalLearning(directory, key);
		opened.push(second);
		await expect(second.open()).rejects.toThrow('Another running MCP');
	});
});
