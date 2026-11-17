import {createHash, randomUUID} from 'node:crypto';
import {type LocalJournal} from '../learning/privacy.js';
import {DesktopError, rejectedAction} from '../utils/errors.js';

type Event = {action_id: string; digest: string; scope_hash?: string; phase: 'intent' | 'result' | 'reconciled'; outcome?: 'success' | 'failed' | 'unknown'; at: number};
export function actionDigest(parts: unknown[]) {
	return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/** An intent without a verified result remains unknown across restarts. No input is logged. */
export class ActionJournal {
	private opening?: Promise<void>;
	private readonly seen = new Set<string>();
	private readonly uncertain = new Set<string>();
	private readonly history: Event[] = [];
	constructor(private readonly journal: LocalJournal) {}
	async blocked(scope: string) {
		this.opening ??= this.load();
		await this.opening;
		return this.uncertain.has(scope);
	}

	async reconcile(scope: string) {
		await this.blocked(scope);
		await this.record({
			action_id: randomUUID(), digest: scope, scope_hash: scope, phase: 'reconciled', at: Date.now(),
		});
		this.uncertain.delete(scope);
	}

	async run<T>(digest: string, dispatch: () => Promise<T>, verify: (result: T) => boolean, actionId: string = randomUUID(), scopeHash = digest) {
		this.opening ??= this.load();
		await this.opening;
		if (this.seen.has(actionId) || this.uncertain.has(scopeHash)) {
			throw rejectedAction('REPLAY_BLOCKED', 'An action ID was reused or this intent has an unknown outcome. Read the target state and obtain operator reconciliation; no replay was sent.');
		}

		const intent: Event = {
			action_id: actionId, digest, scope_hash: scopeHash, phase: 'intent', at: Date.now(),
		};
		this.seen.add(actionId);
		this.uncertain.add(scopeHash);
		await this.record(intent);
		try {
			const result = await dispatch();
			const outcome = verify(result) ? 'success' : 'unknown';
			await this.record({
				action_id: actionId, digest, scope_hash: scopeHash, phase: 'result', outcome, at: Date.now(),
			});
			if (outcome === 'success') {
				this.uncertain.delete(scopeHash);
			}

			return {
				action_id: actionId, outcome, result, verification_required: outcome !== 'success',
			};
		} catch {
			await this.record({
				action_id: actionId, digest, scope_hash: scopeHash, phase: 'result', outcome: 'unknown', at: Date.now(),
			}).catch(() => undefined);
			throw new DesktopError(`Action ${actionId} has an unknown outcome. Read state before retry; matching intent is blocked.`, {code: 'ACTION_OUTCOME_UNKNOWN', disposition: {delivery: 'delivery_uncertain', retry: 'unsafe'}});
		}
	}

	async close() {
		if (this.opening) {
			await this.opening.catch(() => undefined);
		}

		await this.journal.close();
	}

	private async load() {
		const events = await this.journal.load();
		for (const value of events.flatMap((item) => Array.isArray(item) ? item : [item])) {
			const event = value as Event;
			if (!event || !['intent', 'result', 'reconciled'].includes(event.phase) || typeof event.digest !== 'string' || typeof event.action_id !== 'string') {
				throw new Error('Invalid action journal. Preserve it for operator reconciliation.');
			}

			this.history.push(event);
			this.seen.add(event.action_id);
			if (event.phase === 'reconciled' || (event.phase === 'result' && event.outcome === 'success')) {
				this.uncertain.delete(event.scope_hash ?? event.digest);
			} else {
				this.uncertain.add(event.scope_hash ?? event.digest);
			}
		}
	}

	private async record(event: Event) {
		await this.journal.append(event, this.history);
		this.history.push(event);
	}
}
