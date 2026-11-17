import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {type LocalJournal} from '../learning/privacy.js';

export const operationSchema = z.object({
	id: z.uuid(), signature: z.string(), profile: z.string(), origin: z.string(),
	url: z.string(), method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']),
	headers: z.record(z.string(), z.string()), body: z.string().nullable(),
	body_type: z.enum(['none', 'json', 'form', 'unsupported']), label: z.string(),
	cookie_hash: z.string(), cookie_names: z.array(z.string()),
	seen: z.number(), expires: z.number(), observations: z.number().int(), status: z.number(),
	effect: z.enum(['unreviewed', 'read', 'write']), revision: z.number().int(),
	click: z.object({id: z.string(), label: z.string(), delay_ms: z.number()}).nullable(),
}).strict();
export type CapturedOperation = z.infer<typeof operationSchema>;

/** Raw requests stay in an encrypted, single-writer local journal, never tool output. */
export class ApiStore {
	private opening?: Promise<void>;
	private rows: CapturedOperation[] = [];
	private writing: Promise<unknown> = Promise.resolve();
	constructor(private readonly journal: LocalJournal) {}

	async list() {
		await this.open();
		await this.writing;
		return structuredClone(this.rows);
	}

	async put(input: Omit<CapturedOperation, 'id' | 'observations' | 'effect' | 'revision'>) {
		const job = this.writing.catch(() => undefined).then(async () => this.putData(input));
		this.writing = job;
		return job;
	}

	async review(id: string, revision: number, effect: 'read' | 'write') {
		const job = this.writing.catch(() => undefined).then(async () => this.reviewData(id, revision, effect));
		this.writing = job;
		return job;
	}

	async close() {
		await this.writing.catch(() => undefined);
		await this.opening?.catch(() => undefined);
		await this.journal.close();
	}

	async expire(id: string, revision: number) {
		const job = this.writing.catch(() => undefined).then(async () => {
			await this.open();
			const rows = this.rows.map((entry) => entry.id === id && entry.revision === revision ? {...entry, expires: 0, effect: 'unreviewed' as const} : entry);
			await this.journal.replace(rows);
			this.rows = rows;
		});
		this.writing = job;
		await job;
	}

	private async open() {
		this.opening ??= (async () => {
			const records = await this.journal.load();
			if (records.length) {
				this.rows = z.array(operationSchema).max(128).parse(records.at(-1));
			}
		})();
		await this.opening;
	}

	private async putData(input: Omit<CapturedOperation, 'id' | 'observations' | 'effect' | 'revision'>) {
		await this.open();
		const previous = this.rows.find((row) => row.signature === input.signature);
		// A changed nonsecret input requires fresh review even if the operation has the same shape.
		const unchanged = previous?.url === input.url && previous.body === input.body && previous.cookie_hash === input.cookie_hash
			&& JSON.stringify(previous.headers) === JSON.stringify(input.headers);
		const entry = operationSchema.parse({
			...input, id: previous?.id ?? randomUUID(), observations: (previous?.observations ?? 0) + 1,
			effect: unchanged ? previous.effect : 'unreviewed', revision: (previous?.revision ?? 0) + 1,
		});
		const rows = [...this.rows.filter((row) => row.id !== entry.id), entry];
		while (rows.length > 128 || JSON.stringify(rows).length > 2 * 1024 * 1024) {
			rows.shift();
		}

		await this.journal.replace(rows);
		this.rows = rows;
		return structuredClone(entry);
	}

	private async reviewData(id: string, revision: number, effect: 'read' | 'write') {
		await this.open();
		const row = this.rows.find((entry) => entry.id === id && entry.revision === revision);
		if (!row) {
			throw new Error('Operation changed before review. Read the current catalog.');
		}

		const rows = this.rows.map((entry) => entry.id === id ? {...entry, effect} : entry);
		await this.journal.replace(rows);
		this.rows = rows;
	}
}
