import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {z} from 'zod';
import {type PokemonRuntime} from '../pokemon/runtime.js';
import {LocalJournal, redact} from '../learning/privacy.js';
import {approvalIntent} from '../security/approval.js';
import {DesktopRecorder} from './desktop.js';
export const recordingRequest = z.object({
	action: z.enum(['targets', 'open_browser', 'start', 'stop', 'status', 'mark', 'export', 'inspect', 'certificate']), mode: z.enum(['browser', 'desktop']).optional(), target: z.string().max(200).optional(), label: z.string().max(120).optional(), operation: z.string().max(200).optional(), revision: z.number().int().positive().optional(),
}).strict();
type Target = {
	id: string;
	label: string;
	mode: 'browser' | 'desktop';
	origin?: string;
	window_ref?: string | undefined;
	process_id?: number;
};
type Recording = {
	id: string;
	mode: 'browser' | 'desktop';
	target: string;
	label: string;
	started: number;
	stopped?: number;
	reason?: string;
	entries: Record<string, unknown>[];
	markers: {
		at: number;
		label: string;
	}[];
	truncated: boolean;
};
/** Trusted companion UI commands share the owning runtime's browser sessions. */
export class RecordingService {
	private targets: Target[] = [];
	private current: Recording | undefined;
	private queue: Promise<unknown> = Promise.resolve();
	private readonly journal: LocalJournal;
	private opening?: Promise<void>;
	private monitor: ReturnType<typeof setInterval> | undefined;
	private checking = false;
	private closed = false;
	private readonly desktop: DesktopRecorder;
	constructor(private readonly runtime: PokemonRuntime, directory = process.env.POKEMON_RECORDING_DIR || join(process.env.LOCALAPPDATA || homedir(), 'pokemon-companion', 'recording')) {
		this.journal = new LocalJournal(join(directory, 'trace'));
		this.desktop = new DesktopRecorder(join(directory, 'certificate'), (entry) => {
			if (this.current?.mode !== 'desktop' || this.current.stopped || runtime.companion.state.paused) {
				return;
			}

			const marker = this.current.markers.at(-1);
			this.current.entries.push({...entry, ...(marker && entry.at - marker.at <= 3000 ? {near_step: marker.label, delay_ms: entry.at - marker.at} : {})});
			while (this.current.entries.length > 100 || JSON.stringify(this.current.entries).length > 18000) {
				this.current.entries.shift();
				this.current.truncated = true;
			}
		}, () => {
			void this.run(async () => this.stop('Desktop recorder exited.')).catch(() => undefined);
		});
	}

	async request(input: unknown) {
		const request = recordingRequest.parse(input);
		return this.run(async () => {
			if (this.closed) {
				throw new Error('Recorder has closed.');
			}

			await this.open();
			if (request.action === 'targets') {
				return this.listTargets();
			}

			if (request.action === 'certificate') {
				return {desktop: await this.desktop.prepareCertificate()};
			}

			if (request.action === 'open_browser') {
				if (this.runtime.companion.state.paused) {
					throw new Error('Resume Pokémon control before opening a browser.');
				}

				await this.runtime.browser.launch('chromium', false, join(process.env.LOCALAPPDATA || homedir(), 'pokemon-companion', 'browser', 'recorder'));
				return this.listTargets();
			}

			if (request.action === 'start') {
				if (this.current && !this.current.stopped) {
					throw new Error('Stop the current recording first.');
				}

				if (this.runtime.companion.state.paused) {
					throw new Error('Resume Pokémon control before recording.');
				}

				const target = this.targets.find((item) => item.id === request.target && item.mode === request.mode);
				if (!target) {
					throw new Error('Refresh targets and select an observed browser tab or desktop window.');
				}

				const label = redact(request.label?.trim() || 'Demonstrated action');
				const current: Recording = {
					id: randomUUID(), mode: target.mode, target: target.id, label, started: Date.now(), entries: [], markers: [], truncated: false,
				};
				if (target.mode === 'browser') {
					await this.runtime.api.watchStart(target.id, target.origin!);
				} else {
					const identity = await this.identity(target);
					const refresh = async () => {
						if (this.runtime.companion.state.paused) {
							throw new Error('Recording is paused.');
						}

						const actual = await this.identity(target);
						if (actual.process_started !== identity.process_started || actual.image_path !== identity.image_path) {
							throw new Error('Selected application changed. Refresh targets.');
						}

						return {...approvalIntent('record', 'desktop_start', target.label, 'http://localhost/desktop-recording', `Record HTTP(S) traffic for PID ${identity.process_id} and its ${identity.process_family.length - 1} current child processes. May include other tabs/windows in this application.`, identity, {target: target.id, label}), wait_for_decision: true};
					};

					await this.runtime.authorize(await refresh(), refresh);
					await refresh();
					this.current = current;
					await this.desktop.start(identity.process_family).catch((error: unknown) => {
						this.current = undefined;
						throw error;
					});
					let ticks = 0;
					this.monitor = setInterval(() => {
						if (this.checking || this.closed) {
							return;
						}

						this.checking = true;
						void this.run(async () => {
							if (!this.current || this.current.stopped) {
								return;
							}

							if (this.runtime.companion.state.paused) {
								await this.stop('Stopped when Pokémon was paused.');
								return;
							}

							try {
								const now = await this.identity(target);
								if (now.process_started !== identity.process_started || now.image_path !== identity.image_path) {
									throw new Error('identity changed');
								}
							} catch {
								await this.stop('Selected application closed or changed.');
								return;
							}

							ticks += 1;
							if (ticks % 5 === 0) {
								await this.save();
							}
						}).catch(() => {
							void this.desktop.stop();
						}).finally(() => {
							this.checking = false;
						});
					}, 1000);
					this.monitor.unref();
				}

				this.current = current;
				current.started = Date.now();
				current.markers.push({at: current.started, label});
				await this.save();
			} else if (request.action === 'stop') {
				await this.stop();
			} else if (request.action === 'mark') {
				if (!this.current || this.current.stopped || this.runtime.companion.state.paused) {
					throw new Error('Start recording before marking a step.');
				}

				if (this.current.markers.length >= 40) {
					throw new Error('Step limit reached; start a new recording.');
				}

				this.current.markers.push({at: Date.now(), label: redact(request.label?.trim() || 'Next step')});
				await this.save();
			} else if (request.action === 'inspect') {
				if (this.current?.mode !== 'browser' || !request.operation || !request.revision) {
					throw new Error('Select a browser request to inspect.');
				}

				return this.runtime.api.inspect(this.current.target, request.operation, request.revision);
			}

			await this.refresh();
			if (request.action === 'export') {
				return {
					text: JSON.stringify({
						format: 'pokemon-recording-v1', recording: this.current ?? null, correlation: 'Nearby clicks/step markers are timing evidence, not proof of causation.', desktop_replay: 'Metadata trace only. Desktop headers, bodies, and cookies are omitted. Browser operation IDs refer to encrypted session templates.',
					}, null, 2),
				};
			}

			return this.status();
		});
	}

	pause(paused: boolean) {
		if (paused) {
			void this.desktop.stop();
			void this.run(async () => {
				if (this.current?.mode === 'desktop') {
					await this.stop('Stopped when Pokémon was paused.');
				}
			}).catch(() => undefined);
		}
	}

	async close() {
		this.closed = true;
		await this.desktop.stop();
		if (this.opening) {
			await this.run(async () => {
				await this.open();
				await this.stop('Session closed.');
				await this.journal.close();
			});
		}
	}

	private async run<T>(job: () => Promise<T>): Promise<T> {
		const result = this.queue.then(job);
		this.queue = result.catch(() => undefined);
		return result;
	}

	private async open() {
		this.opening ??= (async () => {
			const rows = await this.journal.load();
			if (rows.length) {
				this.current = rows.at(-1) as Recording;
				if (this.current && !this.current.stopped) {
					this.current.stopped = Date.now();
					this.current.reason = 'Previous recorder session ended.';
				}
			}
		})();
		await this.opening;
	}

	private async identity(target: Target) {
		const result = await this.runtime.windows.request({action: 'app_identity', window_id: target.id, window_ref: target.window_ref});
		return z.object({
			process_id: z.number().int().positive(), process_started: z.string(), image_path: z.string(), process_family: z.array(z.number().int().positive()).min(1).max(128),
		}).parse(result);
	}

	private async listTargets() {
		const browser = this.runtime.browser.allPages().flatMap((item) => {
			try {
				const address = new URL(item.url);
				return ['http:', 'https:'].includes(address.protocol)
					? [{
						id: item.page_id, mode: 'browser' as const, origin: address.origin, label: address.origin,
					}]
					: [];
			} catch {
				return [];
			}
		});
		const native = await this.runtime.windows.request({action: 'get_windows'}).catch(() => ({windows: []}));
		const desktop = z.array(z.object({
			id: z.string(), title: z.string(), process: z.string(), process_id: z.number(), window_ref: z.string().optional(),
		})).safeParse(native.windows);
		this.targets = [...browser.slice(0, 20), ...(desktop.success
			? desktop.data.slice(0, 40).map((item) => ({
				id: item.id, mode: 'desktop' as const, label: redact(`${item.process} · ${item.title}`).slice(0, 90), window_ref: item.window_ref, process_id: item.process_id,
			}))
			: [])];
		return {
			targets: this.targets.map((target) => ({
				id: target.id, mode: target.mode, label: target.label, origin: target.origin,
			})), desktop: this.desktop.readiness(), ...this.status(),
		};
	}

	private status() {
		this.bound();
		return {recording: this.current ?? null, active: Boolean(this.current && !this.current.stopped), paused: this.runtime.companion.state.paused};
	}

	private bound() {
		if (!this.current) {
			return;
		}

		while (Buffer.byteLength(JSON.stringify(this.current)) > 30000 && this.current.entries.length) {
			this.current.entries.shift();
			this.current.truncated = true;
		}

		while (Buffer.byteLength(JSON.stringify(this.current)) > 30000 && this.current.markers.length > 1) {
			this.current.markers.shift();
			this.current.truncated = true;
		}
	}

	private async refresh() {
		if (this.current?.mode === 'browser' && !this.current.stopped) {
			const result = await this.runtime.api.watchRead(this.current.target, 18000);
			this.current.entries = result.operations.filter((row) => row.last_seen >= this.current!.started) as unknown as Record<string, unknown>[];
			this.current.truncated = 'truncated' in result && result.truncated;
			if (!result.watching) {
				this.current.stopped = Date.now();
				this.current.reason = 'Browser watcher stopped or tab closed.';
			}

			await this.save();
		}
	}

	private async stop(reason?: string) {
		clearInterval(this.monitor);
		this.monitor = undefined;
		await this.desktop.stop();
		if (this.current && !this.current.stopped) {
			await this.refresh();
			if (this.current.mode === 'browser') {
				await this.runtime.api.watchStop(this.current.target);
			}

			this.current.stopped = Date.now();
			if (reason) {
				this.current.reason = reason;
			}

			await this.save();
		}
	}

	private async save() {
		if (this.current) {
			this.bound();
			await this.journal.replace(this.current);
		}
	}
}
