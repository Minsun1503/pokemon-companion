import {spawn, type ChildProcess} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {createServer, type Server, type Socket} from 'node:net';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const pokemonIds = ['pikachu', 'riolu', 'lucario', 'clodsire', 'bulbasaur', 'charmander', 'squirtle', 'hello-kitty', 'kuromi'] as const;
export type PokemonId = typeof pokemonIds[number];
export type Activity = 'idle' | 'thinking' | 'working' | 'success' | 'error' | 'paused';
export type PokemonState = {
	pet: PokemonId;
	activity: Activity;
	message: string;
	task: string;
	visible: boolean;
	paused: boolean;
	completedActions: number;
	interactionLocked?: boolean;
	action?: {animation: 'typing' | 'clicking' | 'thinking'; id: number; active: boolean} | undefined;
};

export type Companion = {
	state: PokemonState;
	start: () => Promise<void>;
	update: (patch: Partial<PokemonState>, coordinate?: number[]) => Promise<void>;
	animate?: (patch: Partial<PokemonState>, coordinate?: number[]) => void;
	capture: (hidden: boolean) => Promise<void>;
	clipboard?: (text: string | null) => Promise<void>;
	close: () => Promise<void>;
};

/** One local, authenticated companion per MCP process. stdout stays exclusively MCP. */
export class DesktopCompanion implements Companion {
	state: PokemonState = {
		pet: pokemonIds.includes(process.env.POKEMON_PET as PokemonId) ? process.env.POKEMON_PET as PokemonId : 'pikachu',
		activity: 'idle', message: 'Ready when you are!', task: '', visible: true, paused: false, completedActions: 0,
	};

	private server?: Server;
	private socket?: Socket;
	private child?: ChildProcess;
	private starting?: Promise<void>;
	private sequence = 0;
	private closed = false;
	private closing?: Promise<void>;
	private headlessClipboard: string | undefined;
	private readonly pending = new Map<number, {resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>}>();
	private readonly headless = process.env.POKEMON_UI === 'off';
	private animating = false;
	private animationDirty = false;
	private animationCoordinate: number[] | undefined;

	constructor(private readonly onDisconnect?: () => void) {}

	async start(): Promise<void> {
		if (this.closed) {
			throw new Error('Pokémon companion has closed. Restart the MCP server.');
		}

		if (this.headless) {
			return;
		}

		this.starting ||= this.launch();
		await this.starting;
		if (!this.socket || this.socket.destroyed) {
			throw new Error('Pokémon desktop disconnected. Restart the MCP server to reconnect.');
		}
	}

	async update(patch: Partial<PokemonState>, coordinate?: number[]): Promise<void> {
		await this.start();
		Object.assign(this.state, patch);
		const lockOnly = Object.keys(patch).length === 1 && 'interactionLocked' in patch;
		await this.send('state', {state: this.state, coordinate, ...(lockOnly ? {lock_only: true} : {})});
	}

	/** Only the latest cosmetic state needs to reach the renderer. */
	animate(patch: Partial<PokemonState>, coordinate?: number[]): void {
		Object.assign(this.state, patch);
		if (this.headless || this.closed) {
			return;
		}

		this.animationDirty = true;
		this.animationCoordinate = coordinate ?? this.animationCoordinate;
		if (!this.animating) {
			this.animating = true;
			setImmediate(() => {
				void this.flushAnimation();
			});
		}
	}

	async capture(hidden: boolean): Promise<void> {
		await this.start();
		await this.send('capture', {hidden});
	}

	async close(): Promise<void> {
		this.closing ||= this.shutdown();
		await this.closing;
	}

	async clipboard(text: string | null): Promise<void> {
		await this.start();
		if (this.headless) {
			const {clipboard} = await import('@nut-tree-fork/nut-js');
			if (text !== null) {
				this.headlessClipboard = await clipboard.getContent();
				await clipboard.setContent(text);
			} else if (this.headlessClipboard !== undefined) {
				await clipboard.setContent(this.headlessClipboard);
				this.headlessClipboard = undefined;
			}

			return;
		}

		await this.send('clipboard', {text});
	}

	private async flushAnimation(): Promise<void> {
		try {
			while (this.animationDirty && !this.closed) {
				this.animationDirty = false;
				const coordinate = this.animationCoordinate;
				this.animationCoordinate = undefined;
				try {
					// eslint-disable-next-line no-await-in-loop
					await this.send('state', {state: {...this.state}, coordinate, cosmetic: true});
				} catch {/* Cosmetic bridge failures cannot affect input. */}
			}
		} finally {
			this.animating = false;
		}
	}

	private async shutdown(): Promise<void> {
		this.closed = true;
		if (this.socket && !this.socket.destroyed) {
			try {
				await this.send('quit');
			} catch {/* child cleanup below */}

			this.socket.destroy();
		}

		this.child?.kill();
		this.server?.close();
	}

	private acknowledge(id: number, error?: unknown): void {
		const pending = this.pending.get(id);
		if (!pending) {
			return;
		}

		clearTimeout(pending.timer);
		this.pending.delete(id);
		if (error) {
			pending.reject(new Error(typeof error === 'string' ? error : JSON.stringify(error)));
		} else {
			pending.resolve();
		}
	}

	private async launch(): Promise<void> {
		const root = resolve(process.env.POKEMON_FRONTEND_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '../../../frontend'));
		const electron = process.env.POKEMON_ELECTRON_BINARY || resolve(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
		if (!existsSync(electron) || !existsSync(resolve(root, 'build/main/companion/index.js'))) {
			throw new Error(`Pokémon desktop is not built at ${root}. Run npm install and npm run build there first.`);
		}

		const token = randomBytes(32).toString('hex');
		await new Promise<void>((ready, reject) => {
			const timeout = setTimeout(() => {
				fail(new Error('Pokémon desktop did not become ready within 20 seconds.'));
			}, 20_000);
			const fail = (error: Error) => {
				clearTimeout(timeout);
				this.child?.kill();
				this.server?.close();
				reject(error);
			};

			this.server = createServer((socket) => {
				let authenticated = false;
				let buffer = '';
				const authTimeout = setTimeout(() => socket.destroy(), 5000);
				socket.setEncoding('utf8');
				socket.on('data', (data: string) => {
					buffer += data;
					if (buffer.length > 65536) {
						socket.destroy();
						return;
					}

					let newline: number;
					while ((newline = buffer.indexOf('\n')) >= 0) {
						const line = buffer.slice(0, newline);
						buffer = buffer.slice(newline + 1);
						try {
							const message = JSON.parse(line);
							if (!authenticated) {
								if (message.kind !== 'hello' || message.token !== token || this.socket) {
									socket.destroy();
									return;
								}

								authenticated = true;
								clearTimeout(authTimeout);
								this.socket = socket;
								clearTimeout(timeout);
								ready();
							} else if (message.kind === 'ack' && typeof message.id === 'number') {
								this.acknowledge(message.id, message.error);
							} else if (message.kind === 'pause' && typeof message.paused === 'boolean') {
								this.state.paused = message.paused;
								this.state.activity = message.paused ? 'paused' : 'idle';
							} else if (message.kind === 'select' && pokemonIds.includes(message.pet)) {
								this.state.pet = message.pet;
							}
						} catch {
							socket.destroy();
							return;
						}
					}
				});
				socket.on('error', () => {
					socket.destroy();
				});
				socket.on('close', () => {
					clearTimeout(authTimeout);
					if (!authenticated) {
						return;
					}

					this.state.paused = true;
					for (const pending of this.pending.values()) {
						clearTimeout(pending.timer);
						pending.reject(new Error('Pokémon desktop disconnected.'));
					}

					this.pending.clear();
					if (!this.closed) {
						this.onDisconnect?.();
					}
				});
			});
			this.server.on('error', fail);
			this.server.listen(0, '127.0.0.1', () => {
				const address = this.server!.address();
				if (!address || typeof address === 'string') {
					fail(new Error('Could not open companion bridge.'));
					return;
				}

				const env: NodeJS.ProcessEnv = {...process.env, POKEMON_BRIDGE_PORT: String(address.port), POKEMON_BRIDGE_TOKEN: token};
				delete env.ELECTRON_RUN_AS_NODE;
				const args = [root, '--mcp-companion'];
				if (process.platform === 'linux') {
					// A portable ZIP cannot install a root-owned setuid helper; retain the user-namespace sandbox.
					args.push('--disable-setuid-sandbox');
				}

				this.child = spawn(electron, args, {
					cwd: root, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
				});
				this.child.stderr?.on('data', (data: Buffer) => process.stderr.write(data));
				this.child.once('error', fail);
				this.child.once('exit', () => {
					if (!this.socket) {
						fail(new Error('Pokémon desktop exited before connecting.'));
					}
				});
			});
		});
		await this.send('state', {state: this.state});
	}

	private async send(kind: string, data: Record<string, unknown> = {}): Promise<void> {
		if (this.headless) {
			return;
		}

		if (!this.socket || this.socket.destroyed) {
			throw new Error('Pokémon desktop is disconnected.');
		}

		this.sequence += 1;
		const id = this.sequence;
		await new Promise<void>((resolveRequest, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Pokémon desktop timed out handling ${kind}.`));
			}, 5000);
			this.pending.set(id, {resolve: resolveRequest, reject, timer});
			this.socket!.write(`${JSON.stringify({id, kind, ...data})}\n`);
		});
	}
}
