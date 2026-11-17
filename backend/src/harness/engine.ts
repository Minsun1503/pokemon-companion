/* eslint-disable no-await-in-loop -- Provider failover and desktop actions must execute sequentially. */
import type {CallToolResult, Tool} from '@modelcontextprotocol/sdk/types.js';
import {approvalIntent, hashState} from '../security/approval.js';
import type {HarnessConfig} from './config.js';
import {
	callModel, type ModelClient, type Message, type ModelReply,
} from './models.js';
import {type GatewayApprovals, type TurnContext} from './approvals.js';
import {type HarnessStore} from './store.js';

export type HarnessTools = {list: () => Promise<Tool[]>; call: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<CallToolResult>};
const nativeReads = new Set(['get_windows', 'get_ui', 'read_text', 'wait_for']);
export function needsNativeApproval(name: string, args: Record<string, unknown>) {
	if (name === 'learning') {
		return ['run', 'configure', 'forget'].includes(String(args.action));
	}

	if (name === 'windows') {
		if (nativeReads.has(String(args.action))) {
			return false;
		}

		if ((!args.action || args.action === 'batch') && Array.isArray(args.steps) && args.steps.length) {
			return args.steps.some((step) => !step || !nativeReads.has(String((step as Record<string, unknown>).action)));
		}

		return true;
	}

	if (name === 'computer') {
		return !['get_cursor_position', 'get_screenshot'].includes(String(args.action));
	}

	if (name === 'excel') {
		return !['inspect_workbook', 'read_range', 'find_cells'].includes(String(args.action));
	}

	if (name === 'course') {
		return args.action !== 'read_lesson' && args.action !== 'check_completion';
	}

	if (name === 'app') {
		return Boolean(args.desktop_launch);
	}

	return false; // Browser/API actions use the runtime's server-derived state/draft approval.
}

export class HarnessEngine {
	configuring = false;
	private queue: Promise<unknown> = Promise.resolve();
	private readonly running = new Map<string, AbortController>();
	private queued = 0;
	get busy() {
		return this.queued > 0;
	}

	constructor(readonly config: HarnessConfig, readonly store: HarnessStore, readonly approvals: GatewayApprovals, private readonly tools: HarnessTools, private readonly model: ModelClient = callModel) {}
	stop(principal: string) {
		this.running.get(principal)?.abort();
	}

	async receive(principal: string, text: string, send: TurnContext['send'], privateApprovals?: {principal: string; send: TurnContext['send']}) {
		if (!text.trim() || text.length > 8000) {
			await send('Send text of up to 8,000 characters.');
			return;
		}

		const command = text.trim().split(/\s+/);
		if (command[0] === '/allow' || command[0] === '/deny') {
			await send(this.approvals.decide(privateApprovals?.principal ?? principal, command[1] || '', command[0] === '/allow') ? 'Decision recorded.' : 'Approval expired or belongs to another chat.');
			return;
		}

		if (command[0] === '/stop') {
			this.stop(principal);
			await send('Stopped this chat. Verify any action already dispatched before retrying.');
			return;
		}

		if (command[0] === '/help' || command[0] === '/start') {
			await send('Pokémon Agent\nIn a group, mention this bot, reply to its message, or use /ask@bot_username your question. In private, send your question directly. When desktop relay is enabled, questions go to the configured desktop chat. /api your instruction uses a configured provider key. Use /model [route], /status, /new, /stop. Approvals use /allow <code> or /deny <code> in the private bot chat.');
			return;
		}

		const greeting = /^(?:hi|hello|hey|xin chào|chào)[!.?\s]*$/i.test(text.trim());
		if (command[0] === '/status' || greeting) {
			if (this.config.desktopRelay?.enabled) {
				let data: Record<string, unknown>;
				try {
					data = this.relayResult(await this.tools.call('assistant', {action: 'inspect', conversation: this.config.desktopRelay.conversation}, AbortSignal.timeout(30000)));
				} catch {
					data = {error: 'Desktop inspection timed out or failed. Check Pokémon control and the desktop conversation.'};
				}

				await send(`${greeting ? 'Hi! ' : ''}Pokémon gateway running. Desktop relay: ${data.ready ? (data.busy ? 'connected; chat is busy' : 'ready') : 'unavailable'}.\nTarget: current ChatGPT desktop conversation. No provider API key is needed. Send /ask your question.${typeof data.error === 'string' ? `\n${data.error}` : ''}`);
				return;
			}

			const route = this.config.routes[this.config.defaultRoute];
			const configured = route?.model && this.store.secret(route.keyEnv);
			await send(`${greeting ? 'Hi! I’m connected to your Pokémon gateway.' : 'Pokémon gateway running.'} Default route: ${this.config.defaultRoute}. Routes: ${Object.keys(this.config.routes).join(', ')}.\n${configured ? 'Provider key and model saved; API access is verified when a task runs.' : 'Task execution is waiting for a provider key and model in local setup.'}`);
			return;
		}

		if (this.configuring) {
			await send('Settings are being updated. Send your task again when setup finishes.');
			return;
		}

		if (this.running.has(principal)) {
			await send('This chat has a running or queued task. Use /stop first.');
			return;
		}

		const session = this.store.session(principal, this.config.defaultRoute);
		if (command[0] === '/model') {
			const route = command[1];
			if (!route) {
				await send(`Current: ${session.route}\nRoutes: ${Object.keys(this.config.routes).join(', ')}`);
				return;
			}

			if (!this.config.routes[route]) {
				await send('Unknown route. Use /model to list configured routes.');
				return;
			}

			session.route = route;
			await this.store.save();
			await send(`Model route: ${route}${this.config.desktopRelay?.enabled ? ' (for /api tasks; desktop questions use the current desktop chat).' : ''}`);
			return;
		}

		if (command[0] === '/new') {
			session.messages = [];
			await this.store.save();
			await send(this.config.desktopRelay?.enabled ? 'Cleared the API task history. Desktop questions still use the configured conversation.' : 'Started a fresh conversation.');
			return;
		}

		if (this.queued >= 8) {
			await send('The desktop queue is full. Try again after a task completes.');
			return;
		}

		const abort = new AbortController();
		this.running.set(principal, abort);
		this.queued += 1;
		const work = this.queue.catch(() => undefined).then(async () => {
			if (abort.signal.aborted) {
				return;
			}

			await this.approvals.context.run({principal: privateApprovals?.principal ?? principal, send: privateApprovals?.send ?? send, signal: abort.signal}, async () => {
				try {
					await this.turn(session, text, send, abort.signal);
				} catch (error) {
					await send(abort.signal.aborted ? 'Task stopped.' : `Task stopped: ${error instanceof Error ? error.message : 'unexpected failure'}`);
				}
			});
		}).finally(() => {
			this.running.delete(principal);
			this.queued -= 1;
		});
		this.queue = work;
		await work;
	}

	async close() {
		for (const abort of this.running.values()) {
			abort.abort();
		}

		await this.queue.catch(() => undefined);
	}

	private async turn(session: {route: string; messages: Message[]}, text: string, send: TurnContext['send'], signal: AbortSignal) {
		const apiTask = /^\/api(?:\s|$)/.test(text);
		const explicitAsk = /^\/ask(?:\s|$)/.test(text);
		if ((this.config.desktopRelay?.enabled && !apiTask) || explicitAsk) {
			if (!this.config.desktopRelay?.enabled || !this.config.desktopRelay.conversation) {
				throw new Error('Desktop relay is not configured.');
			}

			const question = explicitAsk ? text.replace(/^\/ask\s*/, '') : text;
			if (!question.trim()) {
				throw new Error('Use /ask followed by your question.');
			}

			await send('Question queued for the current ChatGPT desktop conversation. I’ll wait if it is busy and return the completed answer here.');
			const result = this.relayResult(await this.tools.call('assistant', {action: 'ask', conversation: this.config.desktopRelay.conversation, question}, signal));
			if (!result.completed || typeof result.answer !== 'string' || !result.answer.trim()) {
				throw new Error(typeof result.error === 'string' ? result.error : 'Desktop relay did not return a completed answer. No automatic resend was attempted.');
			}

			await send(result.answer);
			return;
		}

		if (apiTask) {
			text = text.replace(/^\/api\s*/, '');
			if (!text.trim()) {
				throw new Error('Use /api followed by your instruction.');
			}
		}

		const definitions = await this.tools.list();
		const transcript: Message[] = [...session.messages, {role: 'user', content: text}];
		if (JSON.stringify(transcript).length > 160000) {
			throw new Error('Conversation is full. Use /new to begin a fresh task.');
		}

		const dispatched = new Set<string>();
		const routeNames = [...new Set([session.route, ...this.config.fallbacks])];
		for (let step = 0; step < this.config.maxSteps; step++) {
			signal.throwIfAborted();
			let reply: ModelReply | undefined;
			for (const name of routeNames) {
				const route = this.config.routes[name];
				if (!route) {
					continue;
				}

				try {
					reply = await this.model(route, this.store.secret(route.keyEnv), transcript, definitions, signal);
					break;
				} catch (error) {
					signal.throwIfAborted();
					if (name === routeNames.at(-1)) {
						throw error;
					}
				}
			}

			if (!reply) {
				throw new Error('No configured model route is available.');
			}

			if (reply.calls.length > 8) {
				throw new Error('Model requested too many tools in one step.');
			}

			transcript.push({
				role: 'assistant', content: reply.content, ...(reply.calls.length ? {calls: reply.calls} : {}), ...(reply.reasoning !== undefined ? {reasoning: reply.reasoning, reasoningSource: reply.reasoningSource} : {}),
			});
			if (!reply.calls.length) {
				if (!reply.content.trim()) {
					throw new Error('The model returned an empty reply.');
				}

				session.messages = transcript;
				await this.store.save();
				await send(reply.content);
				return;
			}

			for (const call of reply.calls) {
				signal.throwIfAborted();
				if (!definitions.some((tool) => tool.name === call.name) || !call.id || !call.args || Array.isArray(call.args) || typeof call.args !== 'object') {
					throw new Error('Model requested an invalid tool.');
				}

				if (call.name === 'learning' && call.args.action === 'run') {
					throw new Error('Workflow replay is unavailable through Telegram. Request individual observed actions.');
				}

				const nativeSteps = call.name === 'windows' ? (Array.isArray(call.args.steps) ? call.args.steps : [call.args]) : [];
				if (nativeSteps.some((step) => step && typeof step === 'object' && step.action === 'launch' && /^https?:/i.test(String(step.text)))) {
					throw new Error('Use the browser DOM tool to open web URLs.');
				}

				const digest = hashState({name: call.name, args: call.args});
				const native = needsNativeApproval(call.name, call.args);
				if (native) {
					if (dispatched.has(digest)) {
						throw new Error('Repeated mutation stopped. Observe the result before requesting another action.');
					}

					const action = typeof call.args.action === 'string' ? call.args.action : 'batch';
					const intent = approvalIntent('native', call.name, `${call.name}: ${action}`, 'https://local.pokemon.invalid/native', JSON.stringify(call.args), {}, {digest});
					if (!(await this.approvals.ask(intent)).authorized) {
						throw new Error('Action was not approved. No input was sent.');
					}

					dispatched.add(digest);
				}

				const result = await this.tools.call(call.name, call.args, signal);
				const content = JSON.stringify(result);
				if (/ACTION_OUTCOME_UNKNOWN|REPLAY_BLOCKED|delivery_uncertain|"outcome":"unknown"/.test(content)) {
					throw new Error('Action outcome is uncertain. Read the target and reconcile with the operator before retrying.');
				}

				if (content.length > 64000) {
					throw new Error('Tool response exceeds the context limit. Request a smaller observation.');
				}

				transcript.push({role: 'tool', content, callId: call.id});
			}
		}

		throw new Error('Task reached its step limit. Inspect the current result before continuing.');
	}

	private relayResult(result: CallToolResult): Record<string, unknown> {
		const body = result.content.find((item) => item.type === 'text');
		if (body?.type !== 'text') {
			return {error: 'Desktop relay returned no readable result.'};
		}

		try {
			const parsed: unknown = JSON.parse(body.text);
			return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {error: 'Desktop relay returned an invalid result.'};
		} catch {
			return {error: 'Desktop relay returned an invalid result.'};
		}
	}
}
