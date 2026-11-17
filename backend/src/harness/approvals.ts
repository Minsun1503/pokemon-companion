import {AsyncLocalStorage} from 'node:async_hooks';
import {randomBytes} from 'node:crypto';
import type {ApprovalIntent} from '../security/approval.js';

export type TurnContext = {principal: string; send: (text: string) => Promise<void>; signal: AbortSignal};
export class GatewayApprovals {
	readonly context = new AsyncLocalStorage<TurnContext>();
	private readonly pending = new Map<string, {principal: string; digest: string; scope: string; resolve: (value: boolean) => void}>();
	private desktopGrant: {conversation: string; users: Set<string>} | undefined;
	constructor(private readonly timeout = 300000) {}
	setDesktopGrant(conversation?: string, users: string[] = []) {
		this.desktopGrant = conversation ? {conversation, users: new Set(users)} : undefined;
	}

	async ask(intent: ApprovalIntent): Promise<{authorized: boolean; action_id: string}> {
		const turn = this.context.getStore();
		if (!turn || turn.signal.aborted) {
			return {authorized: false, action_id: intent.action_id};
		}

		const owner = /^telegram:\d+:(\d+)$/.exec(turn.principal)?.[1];
		if (!intent.reconciliation && owner && this.desktopGrant?.users.has(owner)
			&& intent.tool === 'assistant' && intent.operation === 'ask'
			&& intent.target === 'ChatGPT desktop' && intent.origin === 'https://local.pokemon.invalid'
			&& intent.path === '/desktop/chatgpt' && intent.conversation === this.desktopGrant.conversation) {
			return {authorized: true, action_id: intent.action_id};
		}

		const code = randomBytes(16).toString('hex');
		let timer: ReturnType<typeof setTimeout>;
		let abort: () => void;
		const decision = new Promise<boolean>((resolve) => {
			this.pending.set(code, {
				principal: turn.principal, digest: intent.digest, scope: intent.scope_hash, resolve,
			});
			timer = setTimeout(() => {
				resolve(false);
			}, this.timeout);
			abort = () => {
				resolve(false);
			};

			turn.signal.addEventListener('abort', abort, {once: true});
		});
		try {
			await turn.send(`${intent.reconciliation ? 'Review the previous uncertain outcome; this approval sends no input.' : 'Approve one action'}\n${intent.tool}: ${intent.operation}\nTarget (${intent.target_length} characters): ${intent.target}\nOrigin: ${intent.origin}${intent.path}\nConversation: ${intent.conversation || 'unknown'}\nComplete input (${intent.input_length} characters):\n${intent.input_preview}\n\n/allow ${code}\n/deny ${code}\nExpires in ${Math.floor(this.timeout / 1000)} seconds.`);
			return {authorized: await decision, action_id: intent.action_id};
		} finally {
			clearTimeout(timer!);
			turn.signal.removeEventListener('abort', abort!);
			this.pending.delete(code);
		}
	}

	decide(principal: string, code: string, allow: boolean) {
		const request = this.pending.get(code);
		if (request?.principal !== principal) {
			return false;
		}

		this.pending.delete(code); // Consume before resolving; duplicate commands cannot reuse the decision.
		request.resolve(allow);
		return true;
	}

	revokeScope(scope: string) {
		for (const [code, request] of this.pending) {
			if (request.scope === scope) {
				this.pending.delete(code);
				request.resolve(false);
			}
		}
	}
}
