import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {recordTiming, serialize} from '../utils/timing.js';
import {runCrossPlatformRequest} from './cross-platform.js';

export type WindowsRequest = {
	action: string;
	window_id?: string | undefined;
	query?: string | undefined;
	control_type?: string | undefined;
	max_elements?: number;
	max_depth?: number;
	max_chars?: number;
	snapshot?: string | undefined;
	element_id?: number | undefined;
	ref?: string | undefined;
	text?: string | undefined;
	direction?: string | undefined;
	expect_value?: string | undefined;
	timeout_ms?: number | undefined;
};

type RequestOptions = {signal?: AbortSignal | undefined; timeoutMs: number; paused: () => boolean; timeoutError: string};

export class WindowsAutomation {
	private worker: ChildProcessWithoutNullStreams | undefined;
	private sequence = 0;
	private buffer = '';
	private readonly pending = new Map<number, {resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; cleanup: () => void}>();

	warm(): void {
		if (process.platform === 'win32') {
			this.start();
		}
	}

	async requireForeground(windowId: string, options: RequestOptions): Promise<void> {
		if (process.platform === 'win32') {
			const foreground = await this.request({action: 'foreground'}, options);
			if (windowId === '0' || (foreground.id !== windowId && foreground.root_owner_id !== windowId)) {
				throw new Error(`Foreground window mismatch: ${String(foreground.title)} (${String(foreground.process)}, window ${String(foreground.id)}). No input was sent. Call windows activate on ${windowId} once, then verify foreground before retrying.`);
			}
		}
	}

	async request(args: WindowsRequest, options?: RequestOptions): Promise<Record<string, unknown>> {
		// Credit: Cross-platform routing inspired by Vercel Labs agent-desktop
		if (process.platform !== 'win32') {
			const crossResult = await runCrossPlatformRequest(args);
			return this.postProcess(crossResult, args);
		}

		const roundTrip = performance.now();
		this.start();
		this.sequence += 1;
		const id = this.sequence;
		const result = await new Promise<Record<string, unknown>>((resolveRequest, reject) => {
			const timer = setTimeout(() => {
				this.close(new Error(options?.timeoutError ?? 'Windows UI Automation timed out. The app may be unresponsive; re-read its UI or use a screenshot fallback.'));
			}, options?.timeoutMs ?? 20_000);
			const cancel = () => {
				this.close(new Error('Computer action cancelled. After an interrupted wait, call get_ui again for fresh snapshots.'));
			};

			const pauseTimer = options
				? setInterval(() => {
					if (options.paused()) {
						this.close(new Error('Computer control is paused by the user. Ask them to resume from the Pokémon tray or Ctrl+Shift+P. After an interrupted wait, call get_ui again for fresh snapshots.'));
					}
				}, 100)
				: undefined;
			this.pending.set(id, {
				resolve: resolveRequest, reject, cleanup() {
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

	close(error = new Error('Windows UI Automation worker closed.')): void {
		const {worker} = this;
		this.worker = undefined;
		this.buffer = '';
		worker?.kill();
		for (const item of this.pending.values()) {
			item.cleanup();
			item.reject(error);
		}

		this.pending.clear();
	}

	private start(): void {
		if (this.worker) {
			return;
		}

		const powershell = resolve(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
		const file = resolve(dirname(fileURLToPath(import.meta.url)), 'uia-worker.ps1');
		const worker = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', file], {windowsHide: true, stdio: 'pipe'});
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
					const response = JSON.parse(line) as {id: number; result: Record<string, unknown>; error?: string};
					const item = this.pending.get(response.id);
					if (!item) {
						continue;
					}

					item.cleanup();
					this.pending.delete(response.id);
					if (response.error !== undefined) {
						item.reject(new Error(response.error || 'Windows UI Automation failed without an error message. Call get_ui again for fresh snapshots.'));
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
