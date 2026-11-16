import {createHash, randomUUID} from 'node:crypto';
import {
	mkdir, open, readFile, rename, rm, writeFile,
} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {homedir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {loopbackEndpoint} from '../browser/automation.js';

export const identitySchema = z.object({
	image_path: z.string().min(1), process_id: z.number().int().positive(), process_started: z.string(), version: z.string().default(''),
});
export type AppIdentity = z.infer<typeof identitySchema>;
export const operationSchema = z.object({id: z.string(), path: z.string().startsWith('/'), response_schema: z.record(z.string(), z.unknown()).optional()});
export const connectionSchema = z.object({
	identity: identitySchema, updated_at: z.number(),
	cdp: z.object({endpoint: z.string(), page_url: z.string().optional()}).optional(),
	api: z.object({
		endpoint: z.string(), spec_path: z.string(), fingerprint: z.string(), operations: z.array(operationSchema).max(200),
	}).optional(),
	capture: z.object({file: z.string(), filter: z.string(), url: z.string().optional()}).optional(),
});
export type SavedConnection = z.infer<typeof connectionSchema>;
function safeUrl(value: string) {
	const url = new URL(value);
	url.username = '';
	url.password = '';
	url.search = '';
	url.hash = '';
	if (/token|secret|password|credential|session|authorization|sk-[\w-]{12,}|eyJ[\w-]+\./i.test(url.pathname)) {
		url.pathname = '/';
	}

	return url.href;
}

const fileSchema = z.object({version: z.literal(1), entries: z.record(z.string(), connectionSchema)});
type Database = z.infer<typeof fileSchema>;

export function connectionKey(appId: string, identity: AppIdentity): string {
	return createHash('sha256').update(`${appId}\0${identity.image_path.replaceAll('\\', '/').toLowerCase()}`).digest('hex');
}

/** Persist connection metadata only; no session IDs, credentials, response bodies or element refs. */
export class ConnectionStore {
	constructor(readonly file = process.env.POKEMON_CONNECTIONS_FILE || join(process.env.LOCALAPPDATA || homedir(), 'pokemon-companion', 'connections.json')) {}

	async get(appId: string, identity: AppIdentity): Promise<SavedConnection | undefined> {
		const saved = (await this.read()).entries[connectionKey(appId, identity)];
		return saved;
	}

	async put(appId: string, identity: AppIdentity, saved: SavedConnection): Promise<void> {
		saved = connectionSchema.parse(saved);
		if (saved.cdp) {
			loopbackEndpoint(saved.cdp.endpoint);
		}

		if (saved.api) {
			loopbackEndpoint(saved.api.endpoint);
		}

		if (saved.cdp) {
			saved.cdp.endpoint = safeUrl(saved.cdp.endpoint);
			saved.cdp.page_url = saved.cdp.page_url ? safeUrl(saved.cdp.page_url) : undefined;
		}

		if (saved.api) {
			saved.api.endpoint = new URL(safeUrl(saved.api.endpoint)).origin;
			saved.api.operations = saved.api.operations.filter((operation) => !/[?#]|token|secret|password|credential|authorization/i.test(operation.path));
		}

		if (saved.capture) {
			saved.capture.filter = saved.capture.filter.split(/[?#]/)[0]!.slice(0, 500);
			saved.capture.url = saved.capture.url ? safeUrl(saved.capture.url) : undefined;
		}

		await this.update(async (database) => {
			database.entries[connectionKey(appId, identity)] = connectionSchema.parse({...saved, identity, updated_at: Date.now()});
			const keys = Object.keys(database.entries).sort((a, b) => database.entries[a]!.updated_at - database.entries[b]!.updated_at);
			for (const key of keys.slice(0, Math.max(0, keys.length - 128))) {
				Reflect.deleteProperty(database.entries, key);
			}
		});
	}

	async invalidate(appId: string, identity: AppIdentity, source: 'cdp' | 'api' | 'capture'): Promise<void> {
		await this.update(async (database) => {
			const record = database.entries[connectionKey(appId, identity)];
			if (record) {
				record[source] = undefined;
			}
		});
	}

	private async read(): Promise<Database> {
		try {
			const handle = await open(this.file, 'r');
			try {
				if ((await handle.stat()).size > 2 * 1024 * 1024) {
					throw new Error('Connection cache exceeds its size limit.');
				}

				return fileSchema.parse(JSON.parse(await handle.readFile('utf8')));
			} finally {
				await handle.close();
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return {version: 1, entries: {}};
			}

			throw error;
		}
	}

	private async update(change: (database: Database) => Promise<void>): Promise<void> {
		await mkdir(dirname(this.file), {recursive: true, mode: 0o700});
		const lock = `${this.file}.lock`;
		const
			owner = `${process.pid}:${randomUUID()}`;
		let acquired = false;
		for (let i = 0; i < 40; i += 1) {
			try {
				// eslint-disable-next-line no-await-in-loop -- Cross-process cache writer lock.
				await writeFile(lock, owner, {flag: 'wx', mode: 0o600});
				acquired = true;
				break;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
					throw error;
				}

				// eslint-disable-next-line no-await-in-loop -- Reclaim only a verifiably exited writer.
				const previous = await readFile(lock, 'utf8').catch(() => '');
				// eslint-disable-next-line no-await-in-loop -- Validate the stale lock owner before reclamation.
				await this.reclaim(lock, previous);

				// eslint-disable-next-line no-await-in-loop -- Bounded contention wait.
				await delay(50);
			}
		}

		if (!acquired) {
			throw new Error('Connection cache writer is busy.');
		}

		const temporary = `${this.file}.${randomUUID()}.tmp`;
		try {
			const database = await this.read();
			await change(database);
			await writeFile(temporary, JSON.stringify(database), {mode: 0o600});
			await rename(temporary, this.file);
		} finally {
			await rm(temporary, {force: true});
			if (await readFile(lock, 'utf8').catch(() => '') === owner) {
				await rm(lock, {force: true});
			}
		}
	}

	private async reclaim(lock: string, previous: string): Promise<void> {
		const pid = Number(previous.split(':')[0]);
		if (!Number.isSafeInteger(pid) || pid <= 0) {
			return;
		}

		try {
			process.kill(pid, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ESRCH' && await readFile(lock, 'utf8').catch(() => '') === previous) {
				await rm(lock, {force: true});
			}
		}
	}
}
