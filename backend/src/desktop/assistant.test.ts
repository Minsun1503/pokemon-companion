import {describe, it, expect} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import {join, dirname, basename} from 'node:path';
import {tmpdir} from 'node:os';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import {LocalJournal} from '../learning/privacy.js';
import {ActionJournal} from '../browser/actions.js';
import {DesktopAssistant} from './assistant.js';
import type {DesktopRequest} from './adapter.js';
import {registerAssistant} from '../tools/assistant.js';
import {GatewayApprovals} from '../harness/approvals.js';
import {HarnessStore} from '../harness/store.js';
import {HarnessEngine} from '../harness/engine.js';
import {TelegramGateway} from '../harness/telegram.js';
import {defaultConfig} from '../harness/config.js';
import {approvalIntent} from '../security/approval.js';

const conversation = 'Configured current chat';
class NativeFixture {
	draft = '';
	question = 'Previous question';
	reply = 'A stale answer';
	busy = 0;
	invokes = 0;
	fills = 0;
	windowCount = 1;
	drift = false;
	uncertain = false;
	stayBusy = false;
	clip = false;
	newReply = 'A new completed answer from desktop.';
	history = '';
	sequence = 0;
	readonly snapshots = new Map<string, Map<number, string>>();
	async request(args: DesktopRequest): Promise<Record<string, unknown>> {
		if (args.action === 'get_windows') {
			return {windows: Array.from({length: this.windowCount}, () => ({id: '1', window_ref: 'a'.repeat(32), process: 'ChatGPT'})), complete: true};
		}

		if (args.action === 'activate') {
			return {ok: true};
		}

		if (args.action === 'get_ui') {
			this.sequence += 1;
			const snapshot = this.sequence.toString(16).padStart(32, '0');
			const values = new Map<number, string>();
			this.snapshots.set(snapshot, values);
			const node = (id: number, name: string, role = 'Text', actions = ['read_text'], depth = 2) => {
				values.set(id, name);
				return {
					id, name: name.slice(0, 160), role, actions, depth, targetable: true,
				};
			};

			if (args.control_type === 'Document') {
				const root = node(1, this.drift && this.fills ? 'Other conversation' : conversation, 'Document');
				values.set(1, `${this.history}You said:\n${this.question}\nChatGPT said:\n${this.reply}`);
				return {snapshot, complete: true, nodes: [{...root, value: 'app://-/index.html'}]};
			}

			if (args.control_type === 'Group') {
				return {snapshot, complete: true, nodes: [node(1, 'Conversation', 'Group', ['scroll'])]};
			}

			if (this.invokes && !this.stayBusy && this.busy > 0) {
				this.busy -= 1;
				if (!this.busy) {
					this.reply = this.newReply;
				}
			}

			const edit = node(6, 'Work with Codex', 'Edit', ['set_value', 'read_text']);
			values.set(6, this.draft || 'Work with Codex\n');
			return {snapshot, complete: true, nodes: [node(1, 'Conversation', 'Group', ['scroll'], 0), node(2, 'You said:', 'Text', [], 1), node(3, this.question, 'Text', ['read_text'], 1), node(4, 'ChatGPT said:', 'Text', [], 2), node(5, this.reply), {...edit, value: this.draft}, node(7, this.busy || this.stayBusy ? 'Stop' : 'Send prompt', 'Button', ['invoke'])]};
		}

		if (args.action === 'read_text_page') {
			const text = this.snapshots.get(args.snapshot!)?.get(args.element_id!) ?? '';
			const offset = args.text_offset ?? 0;
			const end = Math.min(text.length, offset + (args.text_length ?? 6000));
			return {
				text: text.slice(offset, end), version: text.length.toString(), source_truncated: this.clip && text === this.newReply, has_more: end < text.length, next_offset: end < text.length ? end : null, ...(args.required_text ? {match_count: text.split(args.required_text).length - 1} : {}),
			};
		}

		if (args.action === 'set_value') {
			this.fills += 1;
			this.draft = args.text!;
			return {ok: true};
		}

		if (args.action === 'invoke') {
			this.invokes += 1;
			this.history += `You said:\n${this.question}\nChatGPT said:\n${this.reply}\n`;
			this.question = this.draft;
			this.draft = '';
			this.busy = 3;
			if (this.uncertain) {
				throw new Error('Transport failed after send');
			}

			return {ok: true};
		}

		throw new Error(`Unexpected native action ${args.action}`);
	}
}

async function fixture(run: (assistant: DesktopAssistant, native: NativeFixture, dir: string, store: HarnessStore) => Promise<void>) {
	const dir = await mkdtemp(join(tmpdir(), 'pokemon-relay-'));
	const native = new NativeFixture();
	const host = {
		windows: native, companion: {state: {paused: false}},
		async computerBatch(run: (perform: (name: string, action: () => Promise<CallToolResult>) => Promise<CallToolResult>) => Promise<CallToolResult>, signal: AbortSignal) {
			signal.throwIfAborted();
			return run(async (_name, action) => action());
		},
		async authorize() {/* This fixture's operator has authorized the exact question. */},
	} as unknown as PokemonRuntime;
	const assistant = new DesktopAssistant(host, new ActionJournal(new LocalJournal(join(dir, 'actions'), Buffer.alloc(32, 9))), 10);
	const store = new HarnessStore(new LocalJournal(join(dir, 'store'), Buffer.alloc(32, 9)));
	await store.open();
	try {
		await run(assistant, native, dir, store);
	} finally {
		await assistant.close();
		await store.close();
		expect(dirname(dir)).toBe(tmpdir());
		expect(basename(dir)).toMatch(/^pokemon-relay-/);
		await rm(dir, {recursive: true, force: true});
	}
}

describe('Telegram → MCP → native desktop → Telegram relay', () => {
	it('returns only the new answer over a real MCP transport, gates senders/groups, and bypasses model APIs', async () => fixture(async (assistant, native, _dir, store) => {
		const server = new McpServer({name: 'relay-fixture', version: '1'});
		registerAssistant(server, {assistant} as PokemonRuntime);
		const client = new Client({name: 'telegram-fixture', version: '1'});
		const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		try {
			const settings = {...structuredClone(defaultConfig), desktopRelay: {enabled: true, conversation, approval: 'scoped_grant' as const}};
			let models = 0;
			const engine = new HarnessEngine(settings, store, new GatewayApprovals(), {
				list: async () => (await client.listTools()).tools,
				call: async (name, args, signal) => client.callTool({name, arguments: args}, undefined, {signal}) as Promise<CallToolResult>,
			}, async () => {
				models += 1;
				throw new Error('No API calls permitted');
			});
			const gateway = new TelegramGateway(engine, 'fixture', new Set(['1']), undefined, new Set(['-10']));
			const received: string[] = [];
			gateway.send = async (_chat, text) => {
				received.push(text);
			};

			const update = {update_id: 1, message: {text: '/ask@fixture_bot Exact test question', from: {id: 1}, chat: {id: -10, type: 'group'}}};
			await gateway.handle({...update, message: {...update.message, from: {id: 2}}}, '42', 'fixture_bot');
			await gateway.handle({...update, message: {...update.message, chat: {id: -11, type: 'group'}}}, '42', 'fixture_bot');
			expect(native.invokes).toBe(0);
			await gateway.handle(update, '42', 'fixture_bot');
			await gateway.handle(update, '42', 'fixture_bot');
			expect(models).toBe(0);
			expect(native.question).toBe('Exact test question');
			expect(native.invokes).toBe(1);
			expect(native.fills).toBe(1);
			expect(received.at(-1)).toBe(native.newReply);
			expect(received.join('\n')).not.toContain('A stale answer');
		} finally {
			await client.close();
			await server.close();
		}
	}));
	it('refuses existing drafts and ambiguous windows before any fill', async () => fixture(async (assistant, native) => {
		native.draft = 'A draft the user is writing';
		await expect(assistant.ask(conversation, 'question', new AbortController().signal)).rejects.toThrow('unsent draft');
		native.draft = '';
		native.windowCount = 2;
		await expect(assistant.ask(conversation, 'question', new AbortController().signal)).rejects.toThrow('exactly one');
		expect(native.fills).toBe(0);
	}));
	it('supports cancellation while waiting for an idle conversation', async () => fixture(async (assistant, native) => {
		native.stayBusy = true;
		const abort = new AbortController();
		const job = assistant.ask(conversation, 'question', abort.signal);
		setTimeout(() => {
			abort.abort();
		}, 25);
		await expect(job).rejects.toThrow();
		expect(native.fills).toBe(0);
		expect(native.invokes).toBe(0);
	}));
	it('stops if the destination changes between filling and sending', async () => fixture(async (assistant, native) => {
		native.drift = true;
		await expect(assistant.ask(conversation, 'question', new AbortController().signal)).rejects.toThrow('unknown outcome');
		expect(native.fills).toBe(1);
		expect(native.invokes).toBe(0);
	}));
	it('blocks retries of an uncertain send, including after reopening the journal', async () => fixture(async (assistant, native, dir) => {
		native.uncertain = true;
		await expect(assistant.ask(conversation, 'question', new AbortController().signal)).rejects.toThrow('unknown outcome');
		await assistant.close();
		const journal = new ActionJournal(new LocalJournal(join(dir, 'actions'), Buffer.alloc(32, 9)));
		try {
			expect(await journal.blocked((await import('../security/approval.js')).hashState({target: 'chatgpt-desktop', conversation}))).toBe(true);
			expect(native.invokes).toBe(1);
		} finally {
			await journal.close();
		}
	}));
	it('paginates long answers without silently clipping them', async () => fixture(async (assistant, native) => {
		native.newReply = 'Long reply '.repeat(1400);
		const result = await assistant.ask(conversation, 'question', new AbortController().signal);
		expect(result.answer).toBe(native.newReply.trim());
	}));
	it('reports source truncation without returning a partial answer', async () => fixture(async (assistant, native) => {
		native.clip = true;
		await expect(assistant.ask(conversation, 'question', new AbortController().signal)).rejects.toThrow('No partial response');
		expect(native.invokes).toBe(1);
	}));
	it('keeps reusable consent limited to the configured owner, destination and relay operation', async () => {
		const approvals = new GatewayApprovals(5);
		approvals.setDesktopGrant(conversation, ['1']);
		const intent = approvalIntent('assistant', 'ask', 'ChatGPT desktop', 'https://local.pokemon.invalid/desktop/chatgpt', 'question', {}, {}, {conversation});
		const run = async (principal: string, value = intent) => approvals.context.run({principal, signal: new AbortController().signal, async send() {/* Discard fixture approval previews. */}}, async () => approvals.ask(value));
		expect((await run('telegram:42:1')).authorized).toBe(true);
		expect((await run('telegram:42:2')).authorized).toBe(false);
		expect((await run('telegram:42:1', {...intent, conversation: 'Other chat'})).authorized).toBe(false);
		expect((await run('telegram:42:1', {...intent, tool: 'windows'})).authorized).toBe(false);
		expect((await run('telegram:42:1', {...intent, reconciliation: true})).authorized).toBe(false);
	});
});
