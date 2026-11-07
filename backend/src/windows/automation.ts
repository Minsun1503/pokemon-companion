import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

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
	text?: string | undefined;
	direction?: string | undefined;
};

export class WindowsAutomation {
	private worker: ChildProcessWithoutNullStreams | undefined;
	private sequence = 0;
	private buffer = '';
	private readonly pending = new Map<number, {resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>}>();

	async request(args: WindowsRequest): Promise<Record<string, unknown>> {
		if (process.platform !== 'win32') {
			throw new Error('Windows UI Automation is available only on Windows. Use the computer tool on this platform.');
		}

		this.start();
		this.sequence += 1;
		const id = this.sequence;
		const result = await new Promise<Record<string, unknown>>((resolveRequest, reject) => {
			const timer = setTimeout(() => {
				this.close(new Error('Windows UI Automation timed out. The app may be unresponsive; re-read its UI or use a screenshot fallback.'));
			}, 20_000);
			this.pending.set(id, {resolve: resolveRequest, reject, timer});
			this.worker!.stdin.write(`${JSON.stringify({id, args: {max_elements: 60, max_depth: 24, ...args}})}\n`);
		});
		const maxChars = args.max_chars ?? 6000;
		const entries = Array.isArray(result.nodes) ? result.nodes : Array.isArray(result.windows) ? result.windows : undefined;
		if (entries) {
			while (entries.length > (args.max_elements ?? 60) || (JSON.stringify(result).length > maxChars && entries.length > 0)) {
				entries.pop();
				result.truncated = true;
			}
		} else if (typeof result.text === 'string') {
			let {text} = result;
			while (typeof text === 'string' && JSON.stringify(result).length > maxChars && text.length > 0) {
				text = text.slice(0, Math.max(0, text.length - Math.max(1, JSON.stringify(result).length - maxChars)));
				result.text = text;
				result.truncated = true;
			}
		}

		return result;
	}

	close(error = new Error('Windows UI Automation worker closed.')): void {
		const {worker} = this;
		this.worker = undefined;
		this.buffer = '';
		worker?.kill();
		for (const item of this.pending.values()) {
			clearTimeout(item.timer);
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

					clearTimeout(item.timer);
					this.pending.delete(response.id);
					if (response.error) {
						item.reject(new Error(response.error));
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
