/* eslint-disable no-await-in-loop -- Provider failover and desktop actions must execute sequentially. */
import type {CallToolResult, Tool} from '@modelcontextprotocol/sdk/types.js';
import {approvalIntent, hashState} from '../security/approval.js';
import {defaultTeam, type HarnessConfig} from './config.js';
import {TeamRunner, specialists} from './team.js';
import {TaskGate} from './task.js';
import {
	callModel, type ModelClient, type Message, type ModelReply,
} from './models.js';
import {type GatewayApprovals, type TurnContext, type ApprovalChannel} from './approvals.js';
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
	private readonly desktop = new TaskGate();
	private readonly teamSlots = new TaskGate(4);
	private readonly teamWork = new Set<Promise<unknown>>();
	get busy() {
		return this.queued > 0;
	}

	constructor(readonly config: HarnessConfig, readonly store: HarnessStore, readonly approvals: GatewayApprovals, private readonly tools: HarnessTools, private readonly model: ModelClient = callModel) {}
	stop(principal: string) {
		this.running.get(principal)?.abort();
	}

	async receive(principal: string, text: string, send: TurnContext['send'], approvalChannel?: ApprovalChannel) {
		if (!text.trim() || text.length > 8000) {
			await send('Send text of up to 8,000 characters.');
			return;
		}

		const command = text.trim().split(/\s+/);
		if (command[0] === '/allow' || command[0] === '/deny') {
			await send(this.approvals.decide(approvalChannel?.principal ?? principal, command[1] || '', command[0] === '/allow') ? 'Decision recorded.' : 'Approval expired or belongs to another chat.');
			return;
		}

		if (command[0] === '/stop') {
			this.stop(principal);
			await send('Stopped this chat. Verify any action already dispatched before retrying.');
			return;
		}

		if (command[0] === '/help' || command[0] === '/start') {
			await send('Pokémon Agent\nIn a group, mention this bot, reply to its message, or use /task@bot_username your question. /ask uses desktop relay; /api uses a provider key. /team your task uses the bounded specialist team and configured API keys. /tasks, /taskstatus <id>, /budget show your team work. /remember <preference>, /memory, /forgetmemory manage your saved preferences. Use /model [route], /status, /new, /stop. Approvals appear in this chat with Allow / Deny buttons; only the requester can decide.');
			return;
		}

		if (['/tasks', '/taskstatus', '/budget'].includes(command[0] ?? '')) {
			const tasks = this.store.tasks(principal);
			if (command[0] === '/taskstatus') {
				const task = tasks.find((item) => item.id === command[1]);
				await send(task ? `${task.id}: ${task.status}\n${task.events.slice(-8).map((event) => event.message).join('\n')}\n${task.result ?? ''}` : 'Task not found in this chat.');
			} else if (command[0] === '/budget') {
				const settings = this.config.team ?? defaultTeam;
				await send(`Team limits per task: ${settings.maxModelCalls} model requests; ${settings.maxTokens} reserved/used tokens; ${settings.maxDelegations} assignments; configured-price USD limit: ${settings.maxCostUsd || 'off'}.\nRecent retained tasks: ${tasks.reduce((sum, task) => sum + task.modelCalls, 0)} requests; configured-price estimate $${tasks.reduce((sum, task) => sum + task.estimatedCostUsd, 0).toFixed(4)}; ${tasks.reduce((sum, task) => sum + task.unknownUsage, 0)} requests without usage; ${tasks.reduce((sum, task) => sum + task.unpricedCalls, 0)} unpriced requests. Estimates exclude tool fees and are not provider billing guarantees.`);
			} else {
				await send(tasks.slice(-10).reverse().map((task) => `${task.id}: ${task.status} — ${task.request.slice(0, 100)}`).join('\n') || 'No team tasks in this chat.');
			}

			return;
		}

		if (['/remember', '/memory', '/forgetmemory'].includes(command[0] ?? '')) {
			if (command[0] === '/remember') {
				const note = text.replace(/^\/remember\s*/, '').trim();
				if (!note || note.length > 500) {
					await send('Use /remember followed by a preference of up to 500 characters.');
					return;
				}

				await this.store.remember(principal, note);
				await send('Preference saved for this chat. It is context, not permission to act.');
			} else if (command[0] === '/forgetmemory') {
				await this.store.clearMemories(principal);
				await send('Saved preferences cleared for this chat.');
			} else {
				await send(this.store.memories(principal).join('\n') || 'No saved preferences in this chat.');
			}

			return;
		}

		if (command[0] === '/team' && command.length === 1) {
			await send(`Pokémon team: coordinator + ${Object.keys(specialists).join(', ')}. Specialists run only when useful, share one budget, and cannot delegate recursively. Use /team your task. API key/model required; desktop relay is separate.`);
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
			await send(approvalChannel?.conversational ? 'Mình đang xử lý việc trước. Bạn có thể nói “dừng lại” nếu muốn đổi việc.' : 'This chat has a running or queued task. Use /stop first.');
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
			session.taskContextAfter = Date.now();
			session.taskContextBoundary = this.store.tasks(principal).at(-1)?.id;
			await this.store.save();
			await send(approvalChannel?.conversational ? 'Đã bắt đầu phiên mới. Bạn muốn làm gì?' : this.config.desktopRelay?.enabled ? 'Cleared the API task history. Desktop questions still use the configured conversation.' : 'Started a fresh conversation.');
			return;
		}

		if (this.queued >= 8) {
			await send('The desktop queue is full. Try again after a task completes.');
			return;
		}

		const abort = new AbortController();
		this.running.set(principal, abort);
		this.queued += 1;
		const settings = this.config.team ?? defaultTeam;
		const teamTask = command[0] === '/team' || (settings.enabled && settings.auto && command[0] !== '/ask' && (!this.config.desktopRelay?.enabled || command[0] === '/api'));
		if (teamTask) {
			const work = this.runTeam(principal, text.replace(/^\/(?:team|api)\s*/, ''), session.route, send, abort.signal, approvalChannel).finally(() => {
				this.running.delete(principal);
				this.queued -= 1;
			});
			this.teamWork.add(work);
			try {
				await work;
			} finally {
				this.teamWork.delete(work);
			}

			return;
		}

		const work = this.queue.catch(() => undefined).then(async () => {
			if (abort.signal.aborted) {
				return;
			}

			const release = await this.desktop.acquire(abort.signal);
			try {
				await this.approvals.context.run({
					principal: approvalChannel?.principal ?? principal, send: approvalChannel?.send ?? send, signal: abort.signal, ...(approvalChannel?.sendApproval ? {sendApproval: approvalChannel.sendApproval} : {}),
				}, async () => {
					try {
						await this.turn(session, text, send, abort.signal, approvalChannel?.conversational);
					} catch (error) {
						await send(abort.signal.aborted ? 'Task stopped.' : `Task stopped: ${error instanceof Error ? error.message : 'unexpected failure'}`);
					}
				});
			} finally {
				release();
			}
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
		await Promise.allSettled([...this.teamWork]);
	}

	private async runTeam(principal: string, request: string, route: string, send: TurnContext['send'], signal: AbortSignal, approvalChannel?: ApprovalChannel) {
		const task = this.store.createTask(principal, request);
		let release: (() => void) | undefined;
		let completedSaved = false;
		try {
			await this.store.checkpoint(task, 'Accepted. No actions replay automatically after restart.');
			if (!request.trim()) {
				throw new Error('Include an instruction after /team or /api.');
			}

			if (!(this.config.team ?? defaultTeam).enabled) {
				throw new Error('Team mode is disabled in local setup.');
			}

			if (!approvalChannel?.conversational) {
				await send(`Task ${task.id} accepted. Use /taskstatus ${task.id}, /budget or /stop.`);
			}

			release = await this.teamSlots.acquire(signal);
			task.status = 'running';
			await this.store.checkpoint(task, 'Coordinator started.');
			const dispatched = new Set<string>();
			const result = await this.approvals.context.run({
				principal: approvalChannel?.principal ?? principal, send: approvalChannel?.send ?? send, signal, ...(approvalChannel?.sendApproval ? {sendApproval: approvalChannel.sendApproval} : {}),
			}, async () => {
				const runner = new TeamRunner({
					config: this.config, store: this.store, task, route, model: this.model, tools: await this.tools.list(), signal, desktop: this.desktop,
					send: approvalChannel?.conversational ? async () => {/* Internal progress stays in the task ledger. */} : send,
					call: async (name, args, toolSignal) => this.approvals.context.run({
						principal: approvalChannel?.principal ?? principal, send: approvalChannel?.send ?? send, signal: toolSignal, ...(approvalChannel?.sendApproval ? {sendApproval: approvalChannel.sendApproval} : {}),
					}, async () => this.executeTool(name, args, toolSignal, dispatched)),
				});
				return runner.run(request);
			});
			signal.throwIfAborted();
			task.result = result;
			task.status = 'completed';
			await this.store.checkpoint(task, 'Coordinator result saved.');
			completedSaved = true;
			await send(approvalChannel?.conversational ? result : `Task ${task.id} completed\n\n${result}`);
		} catch (error) {
			// Preserve a completed result if Telegram delivery fails; /taskstatus can retrieve it.
			if (!completedSaved) {
				task.status = signal.aborted ? 'stopped' : 'failed';
				task.result = error instanceof Error ? error.message : 'Unexpected team failure.';
				await this.store.checkpoint(task, task.result);
			}

			const failure = signal.aborted
				? 'Đã dừng việc này. Mình sẽ không tự gửi lại thao tác đã chạy.'
				: /token budget|configured estimate/.test(task.result ?? '')
					? 'Mình đã chạm giới hạn xử lý của lượt này nên chưa hoàn thành. Mình sẽ không tự chạy lại các thao tác đã gửi.'
					: `Mình chưa hoàn thành được việc này. ${task.result}`;
			await send(approvalChannel?.conversational ? failure : `Task ${task.id}: ${task.status}. ${task.result}`).catch(() => undefined);
		} finally {
			release?.();
		}
	}

	private async executeTool(name: string, args: Record<string, unknown>, signal: AbortSignal, dispatched: Set<string>) {
		signal.throwIfAborted();
		if (!args || Array.isArray(args) || typeof args !== 'object') {
			throw new Error('Invalid tool arguments.');
		}

		if (name === 'learning' && args.action === 'run') {
			throw new Error('Workflow replay is unavailable through Telegram.');
		}

		const steps = name === 'windows' ? (Array.isArray(args.steps) ? args.steps : [args]) : [];
		if (steps.some((step) => step && typeof step === 'object' && step.action === 'launch' && /^https?:/i.test(String(step.text)))) {
			throw new Error('Use browser DOM tools to open URLs.');
		}

		const digest = hashState({name, args});
		if (needsNativeApproval(name, args)) {
			if (dispatched.has(digest)) {
				throw new Error('Repeated mutation stopped. Observe the result before requesting another action.');
			}

			const intent = approvalIntent('native', name, `${name}: ${typeof args.action === 'string' ? args.action : 'batch'}`, 'https://local.pokemon.invalid/native', JSON.stringify(args), {}, {digest});
			if (!(await this.approvals.ask(intent)).authorized) {
				throw new Error('Action was not approved. No input was sent.');
			}

			signal.throwIfAborted();
			dispatched.add(digest);
		}

		return this.tools.call(name, args, signal);
	}

	private async turn(session: {route: string; messages: Message[]}, text: string, send: TurnContext['send'], signal: AbortSignal, conversational = false) {
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

			if (!conversational) {
				await send('Question queued for the current ChatGPT desktop conversation. I’ll wait if it is busy and return the completed answer here.');
			}

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
