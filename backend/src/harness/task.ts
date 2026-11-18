import {randomBytes} from 'node:crypto';

export type TaskRecord = {
	id: string; owner: string; request: string;
	status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped' | 'interrupted';
	createdAt: number; updatedAt: number; result?: string;
	modelCalls: number; inputTokens: number; outputTokens: number; reservedTokens: number;
	estimatedCostUsd: number; unknownUsage: number; unpricedCalls: number;
	artifacts: {role: string; content: string}[];
	events: {at: number; message: string}[];
};
export function newTask(owner: string, request: string): TaskRecord {
	return {
		id: randomBytes(6).toString('hex'), owner, request, status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), modelCalls: 0, inputTokens: 0, outputTokens: 0, reservedTokens: 0, estimatedCostUsd: 0, unknownUsage: 0, unpricedCalls: 0, artifacts: [], events: [],
	};
}

/** FIFO, abortable leases. A released/aborted waiter cannot retain capacity. */
export class TaskGate {
	private active = 0;
	private readonly waiting: (() => void)[] = [];
	constructor(private readonly capacity = 1) {}
	async acquire(signal: AbortSignal): Promise<() => void> {
		signal.throwIfAborted();
		if (this.active >= this.capacity) {
			await new Promise<void>((resolve, reject) => {
				const wake = () => {
					signal.removeEventListener('abort', abort);
					resolve();
				};

				const abort = () => {
					const index = this.waiting.indexOf(wake);
					if (index >= 0) {
						this.waiting.splice(index, 1);
					}

					signal.removeEventListener('abort', abort);
					reject(signal.reason instanceof Error ? signal.reason : new Error('Task cancelled.'));
				};

				this.waiting.push(wake);
				signal.addEventListener('abort', abort, {once: true});
			});
		} else {
			this.active += 1;
		}

		let released = false;
		const release = () => {
			if (released) {
				return;
			}

			released = true;
			const next = this.waiting.shift();
			if (next) {
				// Transfer the existing slot, without exposing a race.
				next();
			} else {
				this.active -= 1;
			}
		};

		if (signal.aborted) {
			release();
			signal.throwIfAborted();
		}

		return release;
	}
}
