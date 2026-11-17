import {spawn, execFile, type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const traceSchema = z.object({
	kind: z.literal('request'), at: z.number(), method: z.string().max(12), endpoint: z.string().max(700), status: z.number(), duration_ms: z.number(), body_bytes: z.number(), failed: z.boolean(),
}).strict();
export type DesktopTrace = z.infer<typeof traceSchema>;
/** A single local redirector, scoped to a native-verified process family. */
export class DesktopRecorder {
	readonly executable = process.env.POKEMON_MITMDUMP || join(root, '.venv-api', 'Scripts', 'mitmdump.exe');
	private child: ChildProcess | undefined;
	private stopping: Promise<void> | undefined;
	private ended = false;
	constructor(private readonly directory: string, private readonly receive: (trace: DesktopTrace) => void, private readonly failed: () => void) { }
	readiness() {
		return {
			installed: existsSync(this.executable), certificate: join(this.directory, 'mitmproxy-ca-cert.cer'), certificate_exists: existsSync(join(this.directory, 'mitmproxy-ca-cert.cer')),
			note: 'Captures HTTP(S) from the selected process and its current children, including other tabs/windows in that app. New child processes require restarting Record. Windows may request administrator approval. HTTPS requires trusting the recorder certificate in that app. Certificate pinning, other protocols, and loopback traffic may prevent capture. Proxy and certificate trust settings are left for you to configure.',
		};
	}

	async prepareCertificate() {
		if (this.readiness().certificate_exists) {
			return this.readiness();
		}

		const python = process.env.POKEMON_CAPTURE_PYTHON || join(dirname(this.executable), 'python.exe');
		if (!existsSync(python)) {
			throw new Error('Set POKEMON_CAPTURE_PYTHON to the Python executable with mitmproxy installed.');
		}

		await new Promise<void>((resolvePrepared, reject) => {
			const child = spawn(python, [join(root, 'scripts', 'prepare-recording-certificate.py'), this.directory], {windowsHide: true, stdio: 'ignore'});
			const timer = setTimeout(() => {
				if (process.platform === 'win32' && child.pid) {
					void promisify(execFile)('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true}).catch(() => undefined);
				} else {
					child.kill();
				}

				reject(new Error('Certificate preparation timed out. Check the optional mitmproxy installation.'));
			}, 30000);
			child.once('error', () => {
				clearTimeout(timer);
				reject(new Error('Could not prepare the recorder certificate.'));
			});
			child.once('exit', (code) => {
				clearTimeout(timer);
				if (code === 0) {
					resolvePrepared();
				} else {
					reject(new Error('Could not prepare the recorder certificate.'));
				}
			});
		});
		return this.readiness();
	}

	async start(processIds: number[]) {
		if (this.child || !processIds.length || processIds.length > 128 || !processIds.every((id) => Number.isSafeInteger(id) && id > 0)) {
			throw new Error('Invalid desktop recording scope.');
		}

		if (!this.readiness().installed) {
			throw new Error('mitmdump is missing. Set POKEMON_MITMDUMP to its executable or install the optional recorder dependencies.');
		}

		this.ended = false;
		const child = spawn(this.executable, ['--mode', `local:${processIds.join(',')}`, '--set', `confdir=${this.directory}`, '--set', 'flow_detail=0', '--set', 'termlog_verbosity=error', '-s', join(root, 'scripts', 'record-desktop.py')], {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
		this.child = child;
		let buffer = '';
		await new Promise<void>((resolveReady, reject) => {
			let ready = false;
			const timer = setTimeout(() => {
				reject(new Error('Desktop capture did not start. Check the Windows approval and mitmproxy local-capture setup.'));
			}, 45000);
			child.stdout.on('data', (chunk: Buffer) => {
				buffer += chunk.toString('utf8');
				if (buffer.length > 65536) {
					buffer = '';
					void this.stop();
					reject(new Error('Desktop trace exceeded the transport limit.'));
					return;
				}

				let newline: number;
				while ((newline = buffer.indexOf('\n')) >= 0) {
					const line = buffer.slice(0, newline);
					buffer = buffer.slice(newline + 1);
					if (!line.startsWith('POKEMON_TRACE ')) {
						continue;
					}

					try {
						const data = JSON.parse(line.slice(14));
						if (data.kind === 'ready') {
							ready = true;
							clearTimeout(timer);
							resolveReady();
						} else {
							const trace = traceSchema.safeParse(data);
							if (trace.success && !this.ended) {
								this.receive(trace.data);
							}
						}
					} catch {/* Ignore nonprotocol output, which may contain untrusted application data. */}
				}
			});
			// Never expose proxy logs: they can contain intercepted URLs or credentials.
			child.stderr.resume();
			child.once('error', () => {
				clearTimeout(timer);
				reject(new Error('Could not launch the desktop recorder.'));
			});
			child.once('exit', () => {
				clearTimeout(timer);
				this.child = undefined;
				if (!ready) {
					reject(new Error('Desktop capture could not start. Check mitmproxy local-capture support and Windows administrator approval.'));
				} else if (!this.ended) {
					this.failed();
				}
			});
		}).catch(async (error: unknown) => {
			await this.stop();
			throw error;
		});
	}

	async stop() {
		if (this.stopping) {
			return this.stopping;
		}

		this.ended = true;
		const {child} = this;
		if (!child) {
			return;
		}

		this.stopping = new Promise<void>((resolveStopped) => {
			const timer = setTimeout(() => {
				if (process.platform === 'win32' && child.pid) {
					void promisify(execFile)('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, timeout: 5000}).finally(resolveStopped).catch(() => undefined);
				} else {
					child.kill('SIGKILL');
					resolveStopped();
				}
			}, 5000);
			child.once('exit', () => {
				clearTimeout(timer);
				resolveStopped();
			});
			child.stdin?.on('error', () => undefined);
			child.stdin?.end('stop\n');
		}).finally(() => {
			this.child = undefined;
			this.stopping = undefined;
		});
		return this.stopping;
	}
}
