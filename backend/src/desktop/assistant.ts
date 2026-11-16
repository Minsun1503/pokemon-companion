/* eslint-disable no-await-in-loop -- Native actions, reply polling and paginated reads must stay ordered. */
/* eslint-disable @typescript-eslint/member-ordering -- Keep the orchestration beside its observation helpers. */
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import type {DesktopRequest} from './adapter.js';
import {LocalJournal} from '../learning/privacy.js';
import {ActionJournal} from '../browser/actions.js';
import {approvalIntent, hashState} from '../security/approval.js';
import {rejectedAction} from '../utils/errors.js';

type Node = {id: number; name: string; role: string; actions?: string[]; targetable?: boolean; enabled?: boolean; depth?: number; value?: string};
type Snapshot = {snapshot: string; nodes: Node[]; truncated?: boolean; complete?: boolean};
type Window = {id: string; window_ref: string; process: string};
type View = Snapshot & {window: Window; conversation: string; document: Snapshot; composer: Node; busy: boolean};
type Host = Pick<PokemonRuntime, 'windows' | 'companion' | 'computerBatch' | 'authorize'>;

const normalize = (text: string) => text.replace(/\r\n/g, '\n').trim();
const supported = (node: Node, action: string) => node.targetable === true && node.enabled !== false && node.actions?.includes(action);
const stopped = (message: string) => rejectedAction('RELAY_TARGET_UNAVAILABLE', message);

/** One pinned desktop conversation; no model API, blind input, or automatic resend. */
export class DesktopAssistant {
	private readonly journal: ActionJournal;
	constructor(private readonly host: Host, journal?: ActionJournal, private readonly pollMs = 1500) {
		this.journal = journal ?? new ActionJournal(new LocalJournal(join(process.env.POKEMON_ACTIONS_DIR || join(process.env.LOCALAPPDATA || '.', 'pokemon-companion', 'actions'), 'desktop-relay')));
	}

	async close() {
		await this.journal.close();
	}

	private async native<T>(run: (request: (args: DesktopRequest) => Promise<Record<string, unknown>>) => Promise<T>, signal: AbortSignal): Promise<T> {
		let result!: T;
		await this.host.computerBatch(async (perform) => perform('get_ui', async () => {
			result = await run(async (args) => {
				signal.throwIfAborted();
				if (this.host.companion.state.paused) {
					throw rejectedAction('PAUSED', 'Computer control is paused. Resume Pokémon control before retrying.');
				}

				return this.host.windows.request(args, {
					signal, paused: () => this.host.companion.state.paused, timeoutMs: 15000, timeoutError: 'Desktop relay observation timed out.',
				});
			});
			return {content: []};
		}), signal);
		return result;
	}

	private async observe(request: (args: DesktopRequest) => Promise<Record<string, unknown>>, window: Window, expected?: string): Promise<View> {
		const read = async (args: Partial<DesktopRequest>) => {
			const data = await request({
				action: 'get_ui', window_id: window.id, window_ref: window.window_ref, max_elements: 250, max_depth: 30, max_chars: 128000, ...args,
			}) as Snapshot;
			if (data.truncated || data.complete === false || !Array.isArray(data.nodes) || typeof data.snapshot !== 'string') {
				throw stopped('Desktop controls are incomplete. No reply was clipped or input repeated.');
			}

			return data;
		};

		const document = await read({control_type: 'Document'});
		const roots = document.nodes.filter((node) => node.value === 'app://-/index.html' && supported(node, 'read_text'));
		if (roots.length !== 1) {
			throw stopped('The selected ChatGPT desktop conversation is not available. Open it in the desktop app.');
		}

		const conversation = roots[0]!.name;
		if (!conversation || (expected && conversation !== expected)) {
			throw stopped('The desktop conversation changed. Return to the configured conversation before retrying.');
		}

		const containers = await read({query: 'Conversation', control_type: 'Group'});
		const groups = containers.nodes.filter((node) => node.name === 'Conversation' && node.targetable);
		if (groups.length !== 1) {
			throw stopped('The desktop conversation container is ambiguous or unavailable.');
		}

		const scope = await read({root_snapshot: containers.snapshot, root_element_id: groups[0]!.id});
		const composers = scope.nodes.filter((node) => node.role === 'Edit' && node.name === 'Work with Codex' && supported(node, 'set_value') && supported(node, 'read_text'));
		if (composers.length !== 1) {
			throw stopped('The configured desktop composer is unavailable or ambiguous.');
		}

		return {
			...scope, window, conversation, document: {...document, nodes: roots}, composer: composers[0]!, busy: scope.nodes.some((node) => node.role === 'Button' && /^(Stop|Stop generating|Stop response)$/i.test(node.name)),
		};
	}

	private async discover(signal: AbortSignal, conversation?: string) {
		return this.native(async (request) => {
			const discovery = await request({action: 'get_windows', query: 'ChatGPT', max_chars: 16000});
			const windows = (discovery.windows as Window[] ?? []).filter((window) => window.process.toLowerCase() === 'chatgpt');
			if (discovery.truncated || windows.length !== 1 || !windows[0]?.window_ref) {
				throw stopped('Open exactly one ChatGPT desktop window with the configured conversation.');
			}

			const window = windows[0];
			// Existing app discovery tried CDP/API/Win32 for this app; its actual chat controls require UIA.
			try {
				return await this.observe(request, window, conversation);
			} catch (error) {
				if (!(error instanceof Error) || !/unavailable|not available/.test(error.message)) {
					throw error;
				}

				await request({action: 'activate', window_id: window.id, window_ref: window.window_ref});
				return this.observe(request, window, conversation);
			}
		}, signal);
	}

	async inspect(conversation: string | undefined, signal: AbortSignal) {
		const view = await this.discover(signal, conversation);
		return {
			target: 'ChatGPT desktop', conversation: view.conversation, channel_used: 'uia', busy: view.busy, composer: view.composer.name, ready: true,
		};
	}

	private async text(request: (args: DesktopRequest) => Promise<Record<string, unknown>>, snapshot: string, node: Node) {
		if (!supported(node, 'read_text')) {
			throw stopped('A response text control is ambiguous. The relay will not return incomplete text.');
		}

		let text = '';
		let offset = 0;
		let version: string | undefined;
		for (;;) {
			const page = await request({
				action: 'read_text_page', snapshot, element_id: node.id, text_offset: offset, text_length: 6000, expected_version: version, max_chars: 16000,
			});
			if (page.truncated || page.source_truncated || typeof page.text !== 'string' || typeof page.version !== 'string') {
				throw stopped('The desktop reply exceeds the readable limit. No partial response was returned.');
			}

			version = page.version;
			text += page.text;
			if (text.length > 100000) {
				throw stopped('The desktop reply exceeds 100,000 characters.');
			}

			if (!page.has_more) {
				return text;
			}

			if (typeof page.next_offset !== 'number' || page.next_offset <= offset) {
				throw stopped('Desktop text pagination did not advance.');
			}

			offset = page.next_offset;
		}
	}

	private async draft(request: (args: DesktopRequest) => Promise<Record<string, unknown>>, view: View) {
		const value = normalize(await this.text(request, view.snapshot, view.composer));
		return value === view.composer.name ? '' : value;
	}

	private async questionCount(request: (args: DesktopRequest) => Promise<Record<string, unknown>>, view: View, question: string) {
		const data = await request({
			action: 'read_text_page', snapshot: view.document.snapshot, element_id: view.document.nodes[0]!.id, text_offset: 0, text_length: 1, required_text: question, max_chars: 16000,
		});
		if (data.source_truncated || data.truncated || typeof data.match_count !== 'number') {
			throw stopped('Cannot verify the complete desktop conversation.');
		}

		return data.match_count;
	}

	private async userMatches(request: (args: DesktopRequest) => Promise<Record<string, unknown>>, view: View, question: string) {
		const start = view.nodes.findLastIndex((node) => node.name === 'You said:' && node.role === 'Text' && node.depth === 1);
		if (start < 0) {
			return false;
		}

		const parts: string[] = [];
		for (const node of view.nodes.slice(start + 1)) {
			if (node.role === 'Group' || node.name === 'ChatGPT said:' || node.role === 'Button') {
				break;
			}

			if (node.role === 'Text' && !/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(node.name)) {
				parts.push(await this.text(request, view.snapshot, node));
			}
		}

		return normalize(parts.join('\n')) === normalize(question);
	}

	private async answer(request: (args: DesktopRequest) => Promise<Record<string, unknown>>, view: View, question: string) {
		if (view.busy || !await this.userMatches(request, view, question)) {
			return '';
		}

		const lastUser = view.nodes.findLastIndex((node) => node.name === 'You said:' && node.depth === 1);
		const start = view.nodes.findLastIndex((node) => node.name === 'ChatGPT said:' && node.role === 'Text' && node.depth === 2);
		if (start <= lastUser) {
			return '';
		}

		const parts: string[] = [];
		const depth = view.nodes[start]!.depth!;
		for (const node of view.nodes.slice(start + 1)) {
			if ((node.depth ?? 0) < depth) {
				break;
			}

			if (node.role === 'Text' && node.name.trim() && !['Copy code', 'Enable word wrap'].includes(node.name)) {
				parts.push(await this.text(request, view.snapshot, node));
			}
		}

		return normalize(parts.join('\n'));
	}

	async ask(conversation: string, question: string, signal: AbortSignal, timeoutMs = 600000) {
		question = normalize(question);
		if (!conversation || !question || question.length > 8000 || question === 'Work with Codex') {
			throw stopped('Send a nonempty question of up to 8,000 characters to the configured desktop conversation.');
		}

		let view = await this.discover(signal, conversation);
		const {window} = view;
		const idleDeadline = Date.now() + timeoutMs;
		while (view.busy) {
			if (Date.now() >= idleDeadline) {
				throw stopped('The desktop chat is still busy. No question was sent.');
			}

			await delay(this.pollMs, undefined, {signal});
			view = await this.native(async (request) => this.observe(request, window, conversation), signal);
		}

		const scope = hashState({target: 'chatgpt-desktop', conversation});
		if (await this.journal.blocked(scope)) {
			throw rejectedAction('REPLAY_BLOCKED', 'A previous desktop delivery is uncertain. Inspect it and reconcile locally before sending again.');
		}

		const prepare = async () => this.native(async (request) => {
			const current = await this.observe(request, view.window, conversation);
			if (current.busy || await this.draft(request, current)) {
				throw stopped('The desktop chat became busy or contains an unsent draft. No input was sent.');
			}

			return approvalIntent('assistant', 'ask', 'ChatGPT desktop', 'https://local.pokemon.invalid/desktop/chatgpt', question, {conversation, window: current.window}, {conversation}, {conversation, scope: {conversation}, operationClass: 'ask'});
		}, signal);
		const intent = await prepare();
		await this.host.authorize(intent, prepare);
		const result = await this.native(async (request) => {
			const before = await this.observe(request, view.window, conversation);
			if (before.busy || await this.draft(request, before)) {
				throw stopped('The desktop chat became busy or contains an unsent draft. No input was sent.');
			}

			const count = await this.questionCount(request, before, question);
			return this.journal.run(intent.digest, async () => {
				await request({
					action: 'set_value', snapshot: before.snapshot, element_id: before.composer.id, text: question,
				});
				const filled = await this.observe(request, view.window, conversation);
				if (filled.busy || await this.draft(request, filled) !== question) {
					throw stopped('The question draft could not be verified. Inspect the composer before retrying.');
				}

				const sends = filled.nodes.filter((node) => node.role === 'Button' && /^(Send|Send message|Send prompt|Submit|Submit prompt)$/i.test(node.name) && supported(node, 'invoke'));
				if (sends.length !== 1) {
					throw stopped('No unique send button is exposed. The draft was left for inspection.');
				}

				await request({action: 'invoke', snapshot: filled.snapshot, element_id: sends[0]!.id});
				for (let attempt = 0; attempt < 10; attempt++) {
					await delay(300, undefined, {signal});
					const sent = await this.observe(request, view.window, conversation);
					if (!await this.draft(request, sent) && await this.userMatches(request, sent, question) && await this.questionCount(request, sent, question) > count) {
						return {accepted: true};
					}
				}

				return {accepted: false};
			}, (delivery) => delivery.accepted, intent.action_id, scope);
		}, signal);
		if (result.outcome !== 'success') {
			throw rejectedAction('ACTION_OUTCOME_UNKNOWN', 'Desktop submission is uncertain. It will not be sent again automatically.');
		}

		// Release the desktop lease while the assistant works, so its own MCP actions can execute.
		const deadline = Date.now() + timeoutMs;
		let previous = '';
		while (Date.now() < deadline) {
			await delay(this.pollMs, undefined, {signal});
			const reply = await this.native(async (request) => {
				const current = await this.observe(request, view.window, conversation);
				if (!await this.userMatches(request, current, question)) {
					throw stopped('Another desktop question replaced the relay question. No unrelated answer was returned.');
				}

				return this.answer(request, current, question);
			}, signal);
			if (reply && reply === previous) {
				return {
					target: 'ChatGPT desktop', conversation, channel_used: 'uia', submitted: true, completed: true, answer: reply,
				};
			}

			previous = reply;
		}

		throw stopped('The question was submitted, but no completed answer arrived before the timeout. Check the desktop chat; no resend was attempted.');
	}
}
