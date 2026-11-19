import {it, expect} from 'vitest';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {join, relative, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {LocalJournal} from '../learning/privacy.js';
import {HarnessStore} from './store.js';
import {HarnessEngine, type HarnessTools} from './engine.js';
import {GatewayApprovals} from './approvals.js';
import {defaultConfig, configSchema, type HarnessConfig} from './config.js';
import {callModel, modelUsage, type ModelClient} from './models.js';
import {TaskGate} from './task.js';
import {TelegramGateway} from './telegram.js';
import {compactObservations} from './team.js';
import type {Message} from './models.js';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return {promise, resolve};
}

const usage = {inputTokens: 120, outputTokens: 40};
const tools: HarnessTools = {list: async () => [], call: async () => ({content: []})};
async function fixture(run: (store: HarnessStore, config: HarnessConfig, home: string) => Promise<void>) {
	const home = await mkdtemp(join(tmpdir(), 'pokemon-team-test-'));
	const inside = relative(resolve(tmpdir()), resolve(home));
	if (!inside.startsWith('pokemon-team-test-') || inside.startsWith('..')) {
		throw new Error('Unexpected fixture directory.');
	}

	const store = new HarnessStore(new LocalJournal(join(home, 'store'), Buffer.alloc(32, 12)));
	try {
		await store.open();
		await store.putSecrets({TEAM_FIXTURE_KEY: 'fixture-key'});
		const config = structuredClone(defaultConfig);
		config.routes.deepseek = {
			...config.routes.deepseek!, keyEnv: 'TEAM_FIXTURE_KEY', model: 'fixture', pricing: {input: 1, output: 2},
		};
		await run(store, config, home);
	} finally {
		await store.close();

		await rm(home, {recursive: true, force: true});
	}
}

it('runs Telegram coordinator → isolated writer/reviewer in parallel → final synthesis, using role routes', async () => fixture(async (store, config) => {
	config.desktopRelay = {enabled: true, conversation: 'fixture desktop', approval: 'per_message'};
	config.routes.cheap = {...config.routes.deepseek!, label: 'Cheap specialist'};
	config.team!.routes.writer = 'cheap';
	const bothStarted = deferred();
	const release = deferred();
	let active = 0;
	const childRoutes: string[] = [];
	const model: ModelClient = async (route, _key, messages, definitions, _signal, options) => {
		const coordinator = options!.instructions!.startsWith('You coordinate');
		if (!coordinator) {
			expect(definitions).toEqual([]);
			expect(messages).toHaveLength(1);
			expect(JSON.stringify(messages)).not.toContain('PRIVATE_OLD_HISTORY');
			childRoutes.push(route.label);
			active += 1;
			if (active === 2) {
				bothStarted.resolve();
			}

			await release.promise;
			return {content: options!.instructions!.includes('writer specialist') ? 'Draft with supplied evidence' : 'Checked: correction needed in paragraph 2', calls: [], usage};
		}

		expect(definitions.map((tool) => tool.name)).toEqual(['delegate', 'find_tools']);
		if (messages.at(-1)!.role !== 'tool') {
			return {content: '', calls: [{id: 'd1', name: 'delegate', args: {tasks: [{role: 'writer', instruction: 'Write a draft', context: 'Supplied evidence'}, {role: 'reviewer', instruction: 'Check supplied facts', context: 'Supplied evidence'}]}}], usage};
		}

		expect(messages.at(-1)!.content).toContain('correction needed');
		return {content: 'Final corrected recommendation', calls: [], usage};
	};

	const engine = new HarnessEngine(config, store, new GatewayApprovals(), tools, model);
	store.session('telegram:77:1:-1001', 'deepseek').messages.push({role: 'user', content: 'PRIVATE_OLD_HISTORY'});
	const gateway = new TelegramGateway(engine, 'fixture', async () => ({users: new Set(['1']), groups: new Set<string>()}), async () => undefined);
	gateway.api = async () => true;
	const replies: string[] = [];
	gateway.send = async (_chat, text) => {
		replies.push(text);
	};

	const work = gateway.handle({update_id: 1, message: {text: '/team@fixture_bot Prepare a recommendation', from: {id: 1}, chat: {id: 1, type: 'private'}}}, '77', 'fixture_bot');
	await bothStarted.promise;
	expect(active).toBe(2);
	release.resolve();
	await work;
	expect(childRoutes).toContain('Cheap specialist');
	expect(replies.at(-1)).toContain('Final corrected recommendation');
	expect(replies.join('\n')).not.toMatch(/Task [a-f0-9]+|accepted|working\./);
	const task = store.tasks('telegram:77:1')[0]!;
	expect(task.status).toBe('completed');
	expect(task.modelCalls).toBe(4);
	expect(task.inputTokens).toBe(480);
	expect(task.outputTokens).toBe(160);
	expect(task.unknownUsage).toBe(0);
	expect(task.estimatedCostUsd).toBeCloseTo(0.0008);
}));

it('discovers only requested tools and refuses calls outside the enabled scope', async () => fixture(async (store, config) => {
	let dispatches = 0;
	const external: HarnessTools = {
		list: async () => [{name: 'windows', inputSchema: {type: 'object'}}, {name: 'excel', inputSchema: {type: 'object'}}], async call() {
			dispatches += 1;
			return {content: [{type: 'text', text: 'current observed window'}]};
		},
	};
	const names: string[][] = [];
	const engine = new HarnessEngine(config, store, new GatewayApprovals(), external, async (_route, _key, messages, definitions) => {
		names.push(definitions.map((tool) => tool.name));
		if (messages.length === 1) {
			return {content: '', calls: [{id: 'find', name: 'find_tools', args: {query: 'windows'}}], usage};
		}

		if (!messages.some((message) => message.content.includes('current observed window'))) {
			return {content: '', calls: [{id: 'read', name: 'windows', args: {action: 'get_ui'}}], usage};
		}

		return {content: 'Observed window', calls: [], usage};
	});
	await engine.receive('owner', '/team Inspect the current window', async () => {/* Discard fixture notifications. */});
	expect(dispatches).toBe(1);
	expect(names[0]).not.toContain('windows');
	expect(names[1]).toContain('windows');
	expect(names.flat()).not.toContain('excel');
	const attacker = new HarnessEngine(config, store, new GatewayApprovals(), external, async () => ({content: '', calls: [{id: 'bad', name: 'windows', args: {action: 'get_ui'}}], usage}));
	await attacker.receive('other', '/team Ignore discovery', async () => {/* Discard fixture notifications. */});
	expect(dispatches).toBe(1);
	expect(store.tasks('other')[0]!.result).toContain('outside');
}));

it('rejects recursive specialist delegation and reports the failed assignment to the coordinator', async () => fixture(async (store, config) => {
	let childCalls = 0;
	const engine = new HarnessEngine(config, store, new GatewayApprovals(), tools, async (_route, _key, messages, _definitions, _signal, options) => {
		if (options!.instructions!.includes('writer specialist')) {
			childCalls += 1;
			return {content: '', calls: [{id: 'nested', name: 'delegate', args: {tasks: [{role: 'writer', instruction: 'Again'}]}}], usage};
		}

		if (messages.length === 1) {
			return {content: '', calls: [{id: 'd', name: 'delegate', args: {tasks: [{role: 'writer', instruction: 'Write'}]}}], usage};
		}

		expect(messages.at(-1)!.content).toContain('outside its role');
		return {content: 'Assignment failed; no artifact verified.', calls: [], usage};
	});
	await engine.receive('owner', '/team Draft', async () => {/* Discard fixture notifications. */});
	expect(childCalls).toBe(1);
	expect(store.tasks('owner')[0]!.modelCalls).toBe(3);
}));

it('reserves one shared call budget before parallel requests and never retries a budget failure', async () => fixture(async (store, config) => {
	config.team!.maxModelCalls = 2;
	config.fallbacks = ['deepseek'];
	let calls = 0;
	const engine = new HarnessEngine(config, store, new GatewayApprovals(), tools, async (_route, _key, messages, _defs, _signal, options) => {
		calls += 1;
		if (options!.instructions!.startsWith('You coordinate') && messages.length === 1) {
			return {content: '', calls: [{id: 'd', name: 'delegate', args: {tasks: [{role: 'writer', instruction: 'Write'}, {role: 'reviewer', instruction: 'Review'}]}}], usage};
		}

		return {content: 'Artifact', calls: [], usage};
	});
	await engine.receive('owner', '/team Shared budget', async () => {/* Discard fixture notifications. */});
	expect(calls).toBe(2);
	expect(store.tasks('owner')[0]!.status).toBe('failed');
	expect(store.tasks('owner')[0]!.result).toContain('budget');
}));

it('stops before spending when the token or configured-price reservation does not fit', async () => fixture(async (store, config) => {
	let calls = 0;
	const model: ModelClient = async () => {
		calls += 1;
		return {content: 'unused', calls: [], usage};
	};

	config.team!.maxTokens = 1024;
	await new HarnessEngine(config, store, new GatewayApprovals(), tools, model).receive('tokens', '/team Test', async () => {/* Discard fixture notifications. */});
	expect(store.tasks('tokens')[0]!.result).toContain('token budget');
	config.team!.maxTokens = 100000;
	config.team!.maxCostUsd = 0.00000001;
	await new HarnessEngine(config, store, new GatewayApprovals(), tools, model).receive('cost', '/team Test', async () => {/* Discard fixture notifications. */});
	expect(store.tasks('cost')[0]!.result).toContain('configured-price');
	delete config.routes.deepseek!.pricing;
	await new HarnessEngine(config, store, new GatewayApprovals(), tools, model).receive('unpriced', '/team Test', async () => {/* Discard fixture notifications. */});
	expect(store.tasks('unpriced')[0]!.result).toContain('pricing');
	expect(calls).toBe(0);
}));

it('retains reservations for failed or usage-less provider requests instead of reporting free work', async () => fixture(async (store, config) => {
	config.routes.backup = {...config.routes.deepseek!, label: 'Backup'};
	config.fallbacks = ['backup'];
	const engine = new HarnessEngine(config, store, new GatewayApprovals(), tools, async (route) => {
		if (route.label !== 'Backup') {
			throw new Error('provider HTTP 503');
		}

		return {content: 'Recovered', calls: []};
	});
	await engine.receive('owner', '/team Recover', async () => {/* Discard fixture notifications. */});
	const task = store.tasks('owner')[0]!;
	expect(task.modelCalls).toBe(2);
	expect(task.unknownUsage).toBe(2);
	expect(task.estimatedCostUsd).toBeGreaterThan(0);
	expect(task.reservedTokens).toBeGreaterThan(4096);
}));

it('stops a delegated native tool before dispatch when the owner says stop', async () => fixture(async (store, config) => {
	const approvals = new GatewayApprovals();
	let dispatched = 0;
	const modelInputs: string[] = [];
	const engine = new HarnessEngine(config, store, approvals, {
		list: async () => [{name: 'excel', inputSchema: {type: 'object'}}], async call() {
			dispatched += 1;
			return {content: []};
		},
	}, async (_r, _k, messages, _d, _s, options) => {
		modelInputs.push(JSON.stringify(messages));
		if (options!.instructions!.includes('analyst specialist')) {
			engine.stop('group');
		}

		return options!.instructions!.includes('analyst specialist')
			? {content: '', calls: [{id: 'write', name: 'excel', args: {action: 'write_range', values: [['draft']]}}], usage}
			: {content: '', calls: [{id: 'd', name: 'delegate', args: {tasks: [{role: 'analyst', instruction: 'Fill the requested workbook'}]}}], usage};
	});
	await engine.receive('group', '/team Fill workbook', async () => {/* Discard notifications. */});
	expect(modelInputs.length).toBeGreaterThan(0);
	expect(dispatched).toBe(0);
	expect(store.tasks('group')[0]!.status).toBe('stopped');
	expect(engine.busy).toBe(false);
}));

it('holds the desktop lease across observations while unrelated reasoning work still finishes', async () => fixture(async (store, config) => {
	const firstObserved = deferred();
	const finishFirst = deferred();
	const secondReady = deferred();
	const dispatched: string[] = [];
	const external: HarnessTools = {
		list: async () => [{name: 'windows', inputSchema: {type: 'object'}}], async call(_name, args) {
			dispatched.push(String(args.owner));
			return {content: [{type: 'text', text: 'observed'}]};
		},
	};
	const engine = new HarnessEngine(config, store, new GatewayApprovals(), external, async (_r, _k, messages) => {
		const request = messages[0]!.content;
		if (request === 'text only') {
			return {content: 'Fast reply', calls: [], usage};
		}

		if (messages.length === 1) {
			return {content: '', calls: [{id: 'f', name: 'find_tools', args: {query: 'windows'}}], usage};
		}

		if (messages.length === 3) {
			if (request === 'second') {
				secondReady.resolve();
			}

			return {content: '', calls: [{id: 'r', name: 'windows', args: {action: 'get_ui', owner: request}}], usage};
		}

		if (request === 'first') {
			firstObserved.resolve();
			await finishFirst.promise;
		}

		return {content: 'Verified', calls: [], usage};
	});
	const first = engine.receive('a', '/team first', async () => {/* Discard fixture notifications. */});
	await firstObserved.promise;
	const second = engine.receive('b', '/team second', async () => {/* Discard fixture notifications. */});
	await secondReady.promise;
	await engine.receive('c', '/team text only', async () => {/* Discard fixture notifications. */});
	expect(store.tasks('c')[0]!.status).toBe('completed');
	expect(dispatched).toEqual(['first']);
	finishFirst.resolve();
	await Promise.all([first, second]);
	expect(dispatched).toEqual(['first', 'second']);
}));

it('persists task history encrypted and marks unfinished work interrupted on restart without replay', async () => fixture(async (store, _config, home) => {
	const task = store.createTask('owner', 'PRIVATE_TASK_REQUEST');
	task.status = 'running';
	await store.checkpoint(task, 'PRIVATE_TOOL_OBSERVATION');
	const disk = await readFile(join(home, 'store', 'events.enc'), 'utf8');
	expect(disk).not.toContain('PRIVATE_TASK');
	expect(disk).not.toContain('PRIVATE_TOOL');
	await store.close();
	const reopened = new HarnessStore(new LocalJournal(join(home, 'store'), Buffer.alloc(32, 12)));
	try {
		await reopened.open();
		expect(reopened.tasks('owner')[0]!.status).toBe('interrupted');
		expect(reopened.tasks('stranger')).toEqual([]);
	} finally {
		await reopened.close();
	}
}));

it('stores explicit preferences per chat, injects them only as coordinator context and allows clearing', async () => fixture(async (store, config) => {
	const engine = new HarnessEngine(config, store, new GatewayApprovals(), tools, async (_r, _k, _m, _d, _s, options) => {
		expect(options!.instructions).toContain('Use Vietnamese');
		expect(options!.instructions).toContain('never new authorization');
		return {content: 'Đã hiểu', calls: [], usage};
	});
	await engine.receive('owner', '/remember Use Vietnamese', async () => {/* Discard fixture notifications. */});
	expect(store.memories('other')).toEqual([]);
	await engine.receive('owner', '/team Draft', async () => {/* Discard fixture notifications. */});
	await engine.receive('other', `/taskstatus ${store.tasks('owner')[0]!.id}`, async (text) => {
		expect(text).toContain('not found');
	});
	await engine.receive('owner', '/forgetmemory', async () => {/* Discard fixture notifications. */});
	expect(store.memories('owner')).toEqual([]);
}));

it('preserves capacity when a gate waiter is cancelled, including cancellation after slot transfer', async () => {
	const gate = new TaskGate();
	const a = new AbortController();
	const release = await gate.acquire(a.signal);
	const b = new AbortController();
	const waiting = gate.acquire(b.signal);
	const rejected = expect(waiting).rejects.toBeDefined();
	release();
	b.abort();
	await rejected;
	const third = await gate.acquire(new AbortController().signal);
	third();
	third();
});

it('validates specialist routes, preserves old configuration and normalizes provider usage', () => {
	const old = structuredClone(defaultConfig);
	delete old.team;
	expect(configSchema.parse(old).team).toBeUndefined();
	expect(configSchema.safeParse({...defaultConfig, team: {...defaultConfig.team, routes: {writer: 'missing'}}}).success).toBe(false);
	expect(modelUsage({prompt_tokens: 90, completion_tokens: 10}, true)).toEqual({inputTokens: 90, outputTokens: 10});
	expect(modelUsage({
		input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 80, cache_creation_input_tokens: 20,
	}, false)).toEqual({inputTokens: 110, outputTokens: 5});
	expect(modelUsage({prompt_tokens: -1, completion_tokens: 10}, true)).toBeUndefined();
});

it('does not let a specialist waiting for tools occupy a model-only specialist slot', async () => fixture(async (store, config) => {
	const ready = deferred();
	const release = deferred();
	const started: string[] = [];
	const engine = new HarnessEngine(config, store, new GatewayApprovals(), {
		list: async () => [{name: 'browser', inputSchema: {type: 'object'}}, {name: 'excel', inputSchema: {type: 'object'}}], call: tools.call,
	}, async (_r, _k, messages, _defs, _signal, options) => {
		const role = /Pokémon's (\w+) specialist/.exec(options!.instructions!)?.[1];
		if (role) {
			started.push(role);
			if (started.includes('researcher') && started.includes('writer')) {
				ready.resolve();
			}

			await release.promise;
			return {content: `${role} artifact`, calls: [], usage};
		}

		if (messages.length === 1) {
			return {content: '', calls: [{id: 'd', name: 'delegate', args: {tasks: [{role: 'researcher', instruction: 'Research'}, {role: 'analyst', instruction: 'Analyze'}, {role: 'writer', instruction: 'Draft'}]}}], usage};
		}

		return {content: 'Combined artifacts', calls: [], usage};
	});
	const work = engine.receive('owner', '/team Parallel independent work', async () => {/* Discard notifications. */});
	await ready.promise;
	expect(started).not.toContain('analyst');
	release.resolve();
	await work;
	expect(started).toContain('analyst');
	expect(store.tasks('owner')[0]!.artifacts).toHaveLength(3);
}));

it('auto-routes ordinary work through the team', async () => fixture(async (store, config) => {
	config.team!.auto = true;
	let modelCalls = 0;
	let relayCalls = 0;
	const engine = new HarnessEngine(config, store, new GatewayApprovals(), {
		list: tools.list, async call(name) {
			expect(name).toBe('assistant');
			relayCalls += 1;
			return {content: [{type: 'text', text: JSON.stringify({completed: true, answer: 'Desktop answer'})}]};
		},
	}, async (_r, _k, _messages, _defs, _signal, options) => {
		expect(options!.instructions).toContain('You coordinate');
		modelCalls += 1;
		return {content: 'Team answer', calls: [], usage};
	});
	await engine.receive('owner', 'Ordinary task', async () => {/* Discard notifications. */});
	await engine.receive('owner', 'Second ordinary task', async () => {/* Discard notifications. */});
	expect(modelCalls).toBe(2);
	expect(relayCalls).toBe(0);
	expect(store.tasks('owner')).toHaveLength(2);
}));

it('keeps bounded same-chat task context across followups and clears it with /new', async () => fixture(async (store, config) => {
	const other = store.createTask('other-chat', 'OTHER_CHAT_SECRET');
	other.status = 'completed';
	const old = store.createTask('owner', 'Send the agreed message to ChatGPT');
	old.status = 'failed';
	old.result = 'Uncertain delivery; inspect first';
	const seen: string[] = [];
	const engine = new HarnessEngine(config, store, new GatewayApprovals(), tools, async (_route, _key, messages) => {
		seen.push(messages[0]!.content);
		return {content: 'Ready', calls: [], usage};
	});
	await engine.receive('owner', '/team Do the previous request again', async () => {/* Discard fixture notifications. */});
	expect(seen[0]).toContain(old.request);
	expect(seen[0]).toContain(old.result);
	expect(seen[0]).toContain('Never reuse previous approvals');
	expect(seen[0]).not.toContain('OTHER_CHAT_SECRET');
	await engine.receive('owner', '/new', async () => {/* Discard fixture notifications. */});
	await engine.receive('owner', '/team Start fresh', async () => {/* Discard fixture notifications. */});
	expect(seen[1]).toBe('Start fresh');
	for (let index = 0; index < 6; index++) {
		const task = store.createTask('bounded', 'x'.repeat(3000));
		task.status = 'completed';
		task.result = 'y'.repeat(2000);
	}

	const current = store.createTask('bounded', 'current');
	const context = store.taskContext('bounded', current.id);
	expect(context).toHaveLength(4);
	expect(context.slice(0, -1).every((task) => task.request.length === 2000 && task.result?.length === 1000 && task.requestTruncated && task.resultTruncated)).toBe(true);
	expect(context.at(-1)?.result).toHaveLength(2000);
	expect(context.at(-1)?.resultTruncated).toBe(false);
}));

it('evicts old Windows observations while preserving current evidence, failures and action outcomes', () => {
	const messages: Message[] = [{role: 'user', content: 'Continue'}];
	for (const [id, action, isError] of [['old', 'get_ui', false], ['failed', 'get_ui', true], ['write', 'set_value', false], ['latest', 'get_ui', false]] as const) {
		messages.push({role: 'assistant', content: '', calls: [{id, name: 'windows', args: {action}}]}, {role: 'tool', callId: id, content: JSON.stringify({isError, content: [{type: 'text', text: id.repeat(4000)}]})});
	}

	const before = JSON.stringify(messages).length;
	const retained = messages.filter((message) => ['failed', 'write', 'latest'].includes(message.callId ?? '')).map((message) => message.content);
	compactObservations(messages);
	expect(messages.find((message) => message.callId === 'old')?.content).toContain('observation_evicted');
	expect(messages.filter((message) => ['failed', 'write', 'latest'].includes(message.callId ?? '')).map((message) => message.content)).toEqual(retained);
	expect(JSON.stringify(messages).length).toBeLessThan(before - 10000);
});

it('stops an uncertain tool outcome without synthesis, redispatch or success', async () => fixture(async (store, config) => {
	let dispatches = 0;
	let modelCalls = 0;
	const engine = new HarnessEngine(config, store, new GatewayApprovals(), {
		list: async () => [{name: 'browser', inputSchema: {type: 'object'}}],
		async call() {
			dispatches += 1;
			return {content: [{type: 'text', text: 'delivery_uncertain'}], isError: true};
		},
	}, async (_r, _k, messages) => {
		modelCalls += 1;
		return messages.length === 1 ? {content: '', calls: [{id: 'f', name: 'find_tools', args: {query: 'browser'}}], usage} : {content: '', calls: [{id: 'a', name: 'browser', args: {action: 'click'}}], usage};
	});
	await engine.receive('owner', '/team Inspect requested page', async () => {/* Discard notifications. */});
	expect(dispatches).toBe(1);
	expect(modelCalls).toBe(2);
	expect(store.tasks('owner')[0]!.status).toBe('failed');
	expect(store.tasks('owner')[0]!.result).toContain('Uncertain');
}));

it('sends role instructions/output caps over HTTP and records OpenAI and Anthropic usage', async () => {
	const bodies: Record<string, unknown>[] = [];
	const server = createServer(async (request, response) => {
		let body = '';
		for await (const chunk of request) {
			body += String(chunk);
		}

		bodies.push(JSON.parse(body) as Record<string, unknown>);
		response.setHeader('Content-Type', 'application/json');
		response.end(JSON.stringify(request.url?.endsWith('/messages') ? {content: [{type: 'text', text: 'Artifact'}], usage: {input_tokens: 9, output_tokens: 3}} : {choices: [{message: {content: 'Artifact'}}], usage: {prompt_tokens: 12, completion_tokens: 4}}));
	});
	await new Promise<void>((done) => {
		server.listen(0, '127.0.0.1', done);
	});
	try {
		const address = server.address();
		if (!address || typeof address === 'string') {
			throw new Error('No fixture address');
		}

		const route = {...defaultConfig.routes.deepseek!, model: 'fixture', baseUrl: `http://127.0.0.1:${address.port}/v1`};
		const options = {instructions: 'ROLE_CONTRACT', maxOutputTokens: 256};
		expect((await callModel(route, 'fixture', [{role: 'user', content: 'Write'}], [], new AbortController().signal, options)).usage).toEqual({inputTokens: 12, outputTokens: 4});
		expect((await callModel({...route, transport: 'anthropic'}, 'fixture', [{role: 'user', content: 'Write'}], [], new AbortController().signal, options)).usage).toEqual({inputTokens: 9, outputTokens: 3});
		expect(bodies[0]!.max_tokens).toBe(256);
		expect(bodies[0]!.tools).toBeUndefined();
		expect(JSON.stringify(bodies)).toContain('ROLE_CONTRACT');
		expect(bodies[1]!.max_tokens).toBe(256);
	} finally {
		await new Promise<void>((done) => {
			server.close(() => {
				done();
			});
		});
	}
});
