import {AsyncLocalStorage} from 'node:async_hooks';
import type {ApprovalIntent} from '../security/approval.js';

export type TurnContext = {principal: string; send: (text: string) => Promise<void>; signal: AbortSignal};
export type ReplyChannel = Pick<TurnContext, 'principal' | 'send'> & {conversational?: boolean};
/**
 * Hermes-style trust: only paired owners reach the engine, so their live turns
 * authorize Pokémon's actions without per-action prompts. Outside a turn, or after
 * /stop, nothing is authorized. Repeat-mutation and uncertain-delivery guards in
 * the engine and the Pokémon runtime still apply.
 */
export class GatewayApprovals {
	readonly context = new AsyncLocalStorage<TurnContext>();
	async ask(intent: ApprovalIntent): Promise<{authorized: boolean; action_id: string}> {
		const turn = this.context.getStore();
		return {authorized: Boolean(turn && !turn.signal.aborted), action_id: intent.action_id};
	}

	revokeScope() {/* No pending prompts to cancel. */}
}
