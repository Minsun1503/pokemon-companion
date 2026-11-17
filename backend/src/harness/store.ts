import {type LocalJournal} from '../learning/privacy.js';
import type {Message} from './models.js';

type Session = {route: string; messages: Message[]};
type Snapshot = {secrets: Record<string, string>; sessions: Record<string, Session>; admitted: string[]; telegramOffsets?: Record<string, number>};
/** One encrypted, single-owner store. Credentials never live in repository config or logs. */
export class HarnessStore {
	private data: Snapshot = {secrets: {}, sessions: {}, admitted: []};
	constructor(private readonly journal: LocalJournal) {}
	async open() {
		const records = await this.journal.load();
		if (records.length) {
			this.data = records.at(-1) as Snapshot;
		}

		if (!this.data.secrets || !this.data.sessions || !Array.isArray(this.data.admitted)) {
			throw new Error('Invalid harness store; preserve it for recovery.');
		}
	}

	secret(name: string) {
		return process.env[name]?.trim() || this.data.secrets[name] || '';
	}

	async putSecrets(values: Record<string, string>) {
		Object.assign(this.data.secrets, values);
		await this.save();
	}

	session(id: string, route: string): Session {
		this.data.sessions[id] ||= {route, messages: []};
		return this.data.sessions[id];
	}

	async save() {
		await this.journal.replace(this.data);
	}

	async admit(id: string) {
		if (this.data.admitted.includes(id)) {
			return false;
		}

		this.data.admitted.push(id);
		this.data.admitted = this.data.admitted.slice(-4096);
		await this.save(); // Reserve before dispatch. A crashed turn is never silently replayed.
		return true;
	}

	telegramOffset(botId: string) {
		const offsets = this.data.telegramOffsets;
		const timestamp = offsets?.[`${botId}:time`];
		return timestamp && Date.now() - timestamp < 7 * 86400000 ? offsets?.[botId] : undefined;
	}

	async admitTelegram(botId: string, updateId: number) {
		if (!Number.isSafeInteger(updateId) || updateId < 0) {
			throw new Error('Invalid Telegram update ID.');
		}

		this.data.telegramOffsets ||= {};
		const offsets = this.data.telegramOffsets;
		// Telegram may randomize IDs after a week without updates; time bounds this watermark.
		const now = Date.now();
		const timestampKey = `${botId}:time`;
		if (offsets[timestampKey] && now - offsets[timestampKey] < 7 * 86400000 && updateId <= (offsets[botId] ?? -1)) {
			return false;
		}

		if (this.data.admitted.includes(`telegram:${botId}:${updateId}`)) {
			return false;
		}

		offsets[botId] = updateId;
		offsets[timestampKey] = now;
		await this.save(); // Persist admission before model or desktop work.
		return true;
	}

	async close() {
		await this.journal.close();
	}
}
