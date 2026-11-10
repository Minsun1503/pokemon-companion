import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {recordTiming, serialize} from '../utils/timing.js';
import {CrossPlatformAutomation} from './cross-platform.js';
import {
	DesktopError, nativeFailure, rejectedAction, workerFailure,
} from '../utils/errors.js';

import type {DesktopAdapter, DesktopRequest as WindowsRequest, DesktopRequestOptions as RequestOptions} from '../desktop/adapter.js';
export type {DesktopRequest as WindowsRequest} from '../desktop/adapter.js';
export type {DesktopRequestOptions as RequestOptions} from '../desktop/adapter.js';

export class WindowsAutomation implements DesktopAdapter {
	readonly platform = process.platform === 'darwin' || process.platform === 'linux' ? process.platform : 'win32';
	private readonly desktop = new CrossPlatformAutomation();
	private worker: ChildProcessWithoutNullStreams | undefined;
	private leaseOwner: ChildProcessWithoutNullStreams | undefined;
	private sequence = 0;
	private buffer = '';
	private readonly pending = new Map<number, {action: string; resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; cleanup: () => void}>();

	warm(): void {
		if (process.platform === 'win32') {
			this.start();
		}
	}

	assertControlLease(): void {
		if (this.leaseOwner && this.worker !== this.leaseOwner) {
			throw rejectedAction('CONTROL_LEASE_LOST', 'The desktop control worker exited during this operation. Refresh discovery before continuing.');
		}
	}

	/** Own one named Windows mutex for the whole operation, including all batch steps. */
	async withControlLease<T>(run: () => Promise<T>, signal?: AbortSignal, paused: () => boolean = () => false, timeoutMs = 5000): Promise<T> {
		if (process.platform !== 'win32') {
			return run();
		}

		const deadline = performance.now() + timeoutMs;
		for (;;) {
			if (signal?.aborted || paused()) {
				throw rejectedAction(signal?.aborted ? 'CANCELLED' : 'PAUSED', 'Computer action cancelled or paused before acquiring control.');
			}

			const remaining = deadline - performance.now();
			if (remaining <= 0) {
				throw rejectedAction('CONTROL_BUSY', 'Another Pokémon Companion server holds desktop control. No input was sent.');
			}

			// eslint-disable-next-line no-await-in-loop
			const result = await this.request({action: 'acquire_control'}, {
				signal, timeoutMs: remaining, paused, timeoutError: 'Desktop control lease acquisition timed out.',
			});
			if (result.acquired === true) {
				break;
			}

			if (result.acquired !== false) {
				throw rejectedAction('INCOMPATIBLE_WORKER', 'The worker did not report desktop control lease ownership. Rebuild the native worker.');
			}

			// eslint-disable-next-line no-await-in-loop
			await delay(Math.min(50, Math.max(1, deadline - performance.now())), undefined, {signal}).catch(() => {
				throw rejectedAction('CANCELLED', 'Computer action cancelled before acquiring control.');
			});
		}

		const owner = this.worker;
		this.leaseOwner = owner;
		try {
			return await run();
		} finally {
			this.leaseOwner = undefined;
			if (this.worker === owner) {
				try {
					await this.request({action: 'release_control'}, {timeoutMs: 1000, paused: () => false, timeoutError: 'Desktop control lease release timed out.'});
				} catch {
					// Termination releases the OS-owned mutex even if the cleanup response was lost.
					this.close();
				}
			}
		}
	}

	async requireForeground(windowId: string, options: RequestOptions, windowRef?: string): Promise<void> {
		if (process.platform !== 'win32') {
			throw rejectedAction('ACTION_NOT_SUPPORTED', 'Foreground-guarded physical input is supported only on Windows.');
		}

		const foreground = await this.request({action: 'foreground', ...(windowRef ? {window_id: windowId, window_ref: windowRef} : {})}, options);
		if (windowId === '0' || (foreground.id !== windowId && foreground.root_owner_id !== windowId)) {
			throw rejectedAction('FOREGROUND_MISMATCH', `Foreground window mismatch: ${String(foreground.title)} (${String(foreground.process)}, window ${String(foreground.id)}). No input was sent. Call windows activate on ${windowId} once, then verify foreground before retrying.`);
		}
	}

	async request(args: WindowsRequest, options?: RequestOptions): Promise<Record<string, unknown>> {
		this.assertControlLease();
		if (process.platform !== 'win32') {
			return this.postProcess(await this.desktop.request(args, options), args);
		}

		const roundTrip = performance.now();
		this.start();
		this.sequence += 1;
		const id = this.sequence;
		const result = await new Promise<Record<string, unknown>>((resolveRequest, reject) => {
			const timer = setTimeout(() => {
				this.close(nativeFailure('TIMEOUT', options?.timeoutError ?? 'Windows UI Automation timed out. The app may be unresponsive; re-read its UI or use a screenshot fallback.', args.action));
			}, options?.timeoutMs ?? 20_000);
			const cancel = () => {
				this.close(nativeFailure('CANCELLED', 'Computer action cancelled. After an interrupted wait, call get_ui again for fresh snapshots.', args.action));
			};

			const pauseTimer = options
				? setInterval(() => {
					if (options.paused()) {
						this.close(nativeFailure('PAUSED', 'Computer control is paused by the user. Ask them to resume from the Pokémon tray or Ctrl+Shift+P. After an interrupted wait, call get_ui again for fresh snapshots.', args.action));
					}
				}, 100)
				: undefined;
			this.pending.set(id, {
				action: args.action, resolve: resolveRequest, reject, cleanup() {
					clearTimeout(timer);
					clearInterval(pauseTimer);
					options?.signal?.removeEventListener('abort', cancel);
				},
			});
			options?.signal?.addEventListener('abort', cancel, {once: true});
			if (options?.signal?.aborted) {
				cancel();
				return;
			}

			this.worker!.stdin.write(`${serialize({id, args: {max_elements: 60, max_depth: 24, ...args}})}\n`);
		});
		recordTiming('worker_round_trip', performance.now() - roundTrip);
		if (typeof result.uia_tree_walk_ms === 'number') {
			recordTiming('uia_tree_walk', result.uia_tree_walk_ms);
			delete result.uia_tree_walk_ms;
		}

		return this.postProcess(result, args);
	}

	close(error = new Error('Windows UI Automation worker closed.')): void {
		this.desktop.close();
		const {worker} = this;
		this.worker = undefined;
		this.buffer = '';
		worker?.kill();
		for (const item of this.pending.values()) {
			item.cleanup();
			item.reject(nativeFailure(error instanceof DesktopError ? error.details.code : 'ACTION_FAILED', error.message, item.action));
		}

		this.pending.clear();
	}

	private postProcess(result: Record<string, unknown>, args: WindowsRequest): Record<string, unknown> {
		const postProcessing = performance.now();
		const maxChars = args.max_chars ?? 6000;
		const entries = Array.isArray(result.nodes) ? result.nodes : Array.isArray(result.windows) ? result.windows : undefined;
		// shortcut: match English caption names; add native caption IDs if localized apps need the hint.
		if (args.action === 'get_ui' && !result.truncated && entries?.length && entries.every((node: Record<string, unknown>) => node.role === 'TitleBar'
			|| (node.role === 'Button' && /^(Minimize|Maximize|Restore|Close)$/i.test(String(node.name))))) {
			result.hint = 'Only title-bar controls found. Call activate on this window and read again.';
		}

		if (entries) {
			const limit = args.max_elements ?? 60;
			let size = serialize(result).length;
			if (entries.length > limit || (size > maxChars && entries.length > 0)) {
				result.truncated = true;
				result.complete = false;
				size = serialize(result).length;
				while (entries.length > limit || (size > maxChars && entries.length > 0)) {
					const removed = entries.pop();
					size -= serialize(removed).length + (entries.length > 0 ? 1 : 0);
				}
			}
		} else if (typeof result.text === 'string') {
			let {text} = result;
			while (typeof text === 'string' && serialize(result).length > maxChars && text.length > 0) {
				text = text.slice(0, Math.max(0, text.length - Math.max(1, serialize(result).length - maxChars)));
				result.text = text;
				result.truncated = true;
			}
		}

		recordTiming('post_processing', performance.now() - postProcessing);
		return result;
	}

	private start(): void {
		if (this.worker) {
			return;
		}

		const powershell = resolve(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
		const file = resolve(dirname(fileURLToPath(import.meta.url)), 'uia-worker.ps1');
		const worker = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', file], {windowsHide: true, stdio: 'pipe'});
		this.worker = worker;
		worker.stdout.setEncoding('utf8');
		worker.stdout.on('data', (data: string) => {
			if (this.worker !== worker) {
				return;
			}

			this.buffer += data;
			if (this.buffer.length > 2_000_000) {
				this.close(new Error('Windows UI Automation response exceeded the local buffer limit.'));
				return;
			}

			while (this.buffer.includes('\n')) {
				const newline = this.buffer.indexOf('\n');
				const line = this.buffer.slice(0, newline);
				this.buffer = this.buffer.slice(newline + 1);
				try {
					const response = JSON.parse(line) as {id: number; result: Record<string, unknown>; error?: string; error_details?: unknown};
					const item = this.pending.get(response.id);
					if (!item) {
						continue;
					}

					item.cleanup();
					this.pending.delete(response.id);
					if (response.error !== undefined) {
						item.reject(workerFailure(response.error || 'Windows UI Automation failed without an error message. Call get_ui again for fresh snapshots.', response.error_details, item.action));
					} else if (!response.result || typeof response.result !== 'object' || Array.isArray(response.result)) {
						item.reject(new Error('Windows UI Automation returned an invalid response.'));
					} else {
						item.resolve(response.result);
					}
				} catch {
					this.close(new Error('Windows UI Automation returned an invalid response.'));
					return;
				}
			}
		});
		let diagnostic = '';
		worker.stderr.on('data', (data: Buffer) => {
			diagnostic = (diagnostic + data.toString()).slice(-4000);
		});
		worker.once('error', (error) => {
			if (this.worker === worker) {
				this.close(error);
			}
		});
		worker.stdin.on('error', (error) => {
			if (this.worker === worker) {
				this.close(error);
			}
		});
		worker.once('exit', () => {
			if (this.worker === worker) {
				this.close(new Error(diagnostic.trim() || 'Windows UI Automation worker exited.'));
			}
		});
	}
}
