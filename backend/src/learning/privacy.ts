import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {
	chmod, mkdir, lstat, open, readFile, rename, rm, stat, writeFile,
} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';

const aad = Buffer.from('pokemon-learning-journal-v1');
export type KeyProtector = (input: Buffer, decrypt: boolean) => Promise<Buffer>;
export function redact(text: string): string {
	return text.slice(0, 8192)
		.replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{15,}|github_pat_[\w]{15,}|AKIA[\w]{16})\b/g, '[REDACTED]')
		.replace(/\b(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|authorization)\s*(?:[:=]|\bis\b)\s*(?:"[^"]*"|'[^']*'|\S+)/gi, '[REDACTED]')
		.replace(/Bearer\s+[\w.\-+/=]+/gi, 'Bearer [REDACTED]')
		.replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@');
}

function protect(input: Buffer, decrypt: boolean): Buffer {
	const operation = decrypt ? 'Unprotect' : 'Protect';
	const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::ReadLine()); [Console]::Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))`;
	return Buffer.from(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
		input: `${input.toString('base64')}\n`, encoding: 'utf8', windowsHide: true, timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'],
	}).trim(), 'base64');
}

export class LocalJournal {
	private key: Buffer | undefined;
	private lockOwner = '';
	private pending: Promise<void> = Promise.resolve();
	private closed = false;
	private bytes = 0;
	private readonly keyFile: string;
	private readonly journalFile: string;
	private readonly lockFile: string;
	constructor(readonly directory: string, private readonly testKey?: Buffer, private readonly keyProtector?: KeyProtector) {
		this.keyFile = join(directory, 'key');
		this.journalFile = join(directory, 'events.enc');
		this.lockFile = join(directory, 'writer.lock');
	}

	async load(): Promise<unknown[]> {
		if (this.closed) {
			throw new Error('Learning store has closed.');
		}

		await mkdir(this.directory, {recursive: true, mode: 0o700});
		if ((await lstat(this.directory)).isSymbolicLink()) {
			throw new Error('Learning directory must not be a symbolic link.');
		}

		const owner = JSON.stringify({pid: process.pid, nonce: randomBytes(16).toString('hex')});
		try {
			await writeFile(this.lockFile, owner, {flag: 'wx', mode: 0o600});
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
				throw error;
			}

			const previous = JSON.parse(await readFile(this.lockFile, 'utf8')) as {pid: number};
			if (!Number.isInteger(previous.pid) || previous.pid < 1) {
				throw new Error('Invalid learning writer lock; preserve the store for recovery.');
			}

			try {
				process.kill(previous.pid, 0);
				throw new Error('Another running MCP server owns this learning profile. Use that server or a separate POKEMON_LEARNING_DIR.');
			} catch (probe) {
				if ((probe as NodeJS.ErrnoException).code !== 'ESRCH') {
					throw probe;
				}
			}

			await rm(this.lockFile);
			await writeFile(this.lockFile, owner, {flag: 'wx', mode: 0o600});
		}

		this.lockOwner = owner;
		try {
			if (this.testKey) {
				this.key = Buffer.from(this.testKey);
			} else {
				let saved: Buffer | undefined;
				try {
					await this.rejectLink(this.keyFile);
					saved = await readFile(this.keyFile);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
						throw error;
					}
				}

				if (saved) {
					this.key = process.platform === 'win32' ? await (this.keyProtector?.(saved, true) ?? protect(saved, true)) : saved;
				} else {
					this.key = randomBytes(32);
					const protectedKey = process.platform === 'win32' ? await (this.keyProtector?.(this.key, false) ?? protect(this.key, false)) : this.key;
					await writeFile(this.keyFile, protectedKey, {flag: 'wx', mode: 0o600});
				}
			}

			if (this.key.length !== 32) {
				throw new Error('Invalid learning encryption key.');
			}

			if (process.platform !== 'win32') {
				await chmod(this.directory, 0o700);
				if (!this.testKey) {
					await chmod(this.keyFile, 0o600);
				}
			}

			let size = 0;
			try {
				await this.rejectLink(this.journalFile);
				size = (await stat(this.journalFile)).size;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					return [];
				}

				throw error;
			}

			if (size > 8 * 1024 * 1024) {
				throw new Error('Learning journal exceeded the 8 MiB read limit.');
			}

			const content = await readFile(this.journalFile, 'utf8');
			this.bytes = size;
			return content.split('\n').filter(Boolean).map((line) => this.decode(line));
		} catch (error) {
			await this.close();
			throw error;
		}
	}

	async append(event: unknown, snapshot: unknown): Promise<void> {
		const encoded = this.encode(event);
		const operation = this.pending.then(async () => {
			if (this.bytes + Buffer.byteLength(encoded) > 4 * 1024 * 1024) {
				// Snapshot precedes the new event. Both survive compaction exactly once.
				const compact = this.encode(snapshot) + encoded;
				if (Buffer.byteLength(compact) > 4 * 1024 * 1024) {
					throw new Error('Learning snapshot exceeds the storage budget.');
				}

				const temporary = join(this.directory, `compact-${randomBytes(12).toString('hex')}`);
				await writeFile(temporary, compact, {flag: 'wx', mode: 0o600});
				await rename(temporary, this.journalFile);
				this.bytes = Buffer.byteLength(compact);
			} else {
				// Native flags enforce no-follow where supported, rather than reopening a checked symlink.
				// eslint-disable-next-line no-bitwise
				const handle = await open(this.journalFile, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
				try {
					await handle.writeFile(encoded);
				} finally {
					await handle.close();
				}

				this.bytes += Buffer.byteLength(encoded);
			}
		});
		this.pending = operation.catch(() => undefined);
		return operation;
	}

	async replace(snapshot: unknown): Promise<void> {
		const encoded = this.encode(snapshot);
		const operation = this.pending.then(async () => {
			if (Buffer.byteLength(encoded) > 4 * 1024 * 1024) {
				throw new Error('Learning snapshot exceeds the storage budget.');
			}

			const temporary = join(this.directory, `compact-${randomBytes(12).toString('hex')}`);
			await writeFile(temporary, encoded, {flag: 'wx', mode: 0o600});
			await rename(temporary, this.journalFile);
			this.bytes = Buffer.byteLength(encoded);
		});
		this.pending = operation.catch(() => undefined);
		return operation;
	}

	async close(): Promise<void> {
		await this.pending;
		if (this.lockOwner && await readFile(this.lockFile, 'utf8').catch(() => '') === this.lockOwner) {
			await rm(this.lockFile);
		}

		this.key?.fill(0);
		this.key = undefined;
		this.closed = true;
	}

	private async rejectLink(file: string): Promise<void> {
		if ((await lstat(file)).isSymbolicLink()) {
			throw new Error('Learning files must not be symbolic links.');
		}
	}

	private encode(value: unknown): string {
		if (!this.key || this.closed) {
			throw new Error('Learning store is not open.');
		}

		const nonce = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
		cipher.setAAD(aad);
		const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
		return `${Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64')}\n`;
	}

	private decode(line: string): unknown {
		const buffer = Buffer.from(line, 'base64');
		const decipher = createDecipheriv('aes-256-gcm', this.key!, buffer.subarray(0, 12));
		decipher.setAAD(aad);
		decipher.setAuthTag(buffer.subarray(12, 28));
		return JSON.parse(Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8')) as unknown;
	}
}
