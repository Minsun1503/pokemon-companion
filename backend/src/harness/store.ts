import {type LocalJournal} from '../learning/privacy.js';
import type {Message} from './models.js';
import {newTask, type TaskRecord} from './task.js';

type Session = {route: string; messages: Message[]; taskContextAfter?: number; taskContextBoundary?: string | undefined};
type Snapshot = {secrets: Record<string, string>; sessions: Record<string, Session>; admitted: string[]; telegramOffsets?: Record<string, number>; tasks?: TaskRecord[]; memories?: Record<string, string[]>};
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

		let interrupted = false;
		for (const task of this.data.tasks ?? []) {
			if (task.status === 'queued' || task.status === 'running') {
				task.status = 'interrupted';
				task.updatedAt = Date.now();
				task.events.push({at: Date.now(), message: 'Process restarted. Observe previous actions before starting a new task; no automatic replay.'});
				interrupted = true;
			}
		}

		if (interrupted) {
			await this.save();
		}
	}

	createTask(owner: string, request: string) {
		const task = newTask(owner, request);
		this.data.tasks ||= [];
		this.data.tasks = this.data.tasks.filter((item) => item.status === 'queued' || item.status === 'running').concat(this.data.tasks.filter((item) => item.status !== 'queued' && item.status !== 'running').slice(-15));
		this.data.tasks.push(task);
		return task;
	}

	tasks(owner: string) {
		return (this.data.tasks ?? []).filter((task) => task.owner === owner);
	}

	taskContext(owner: string, currentId: string) {
		const after = this.data.sessions[owner]?.taskContextAfter ?? 0;
		const tasks = this.data.tasks ?? [];
		const index = tasks.findIndex((task) => task.id === currentId);
		const boundary = tasks.findIndex((task) => task.id === this.data.sessions[owner]?.taskContextBoundary);
		return tasks.slice(boundary + 1, Math.max(0, index)).filter((task) => task.owner === owner && task.createdAt >= after
			&& !['queued', 'running'].includes(task.status)).slice(-4).map((task, index, records) => ({
			id: task.id, status: task.status, request: task.request.slice(0, 2000), result: task.result?.slice(0, index === records.length - 1 ? 4000 : 1000),
			requestTruncated: task.request.length > 2000, resultTruncated: (task.result?.length ?? 0) > (index === records.length - 1 ? 4000 : 1000),
		}));
	}

	recentTaskStatus() {
		return (this.data.tasks ?? []).slice(-8).map((task) => ({
			id: task.id, status: task.status, createdAt: task.createdAt, updatedAt: task.updatedAt,
			modelCalls: task.modelCalls, inputTokens: task.inputTokens, outputTokens: task.outputTokens,
			unknownUsage: task.unknownUsage, result: task.result,
			toolEvents: task.events.filter((event) => /^(coordinator|researcher|analyst) (dispatching|received) \w+/.test(event.message)).map((event) => event.message),
		}));
	}

	async checkpoint(task: TaskRecord, message: string) {
		task.updatedAt = Date.now();
		task.events.push({at: task.updatedAt, message: message.slice(0, 1200)});
		task.events = task.events.slice(-80);
		await this.save();
	}

	memories(owner: string) {
		return [...(this.data.memories?.[owner] ?? [])];
	}

	async remember(owner: string, note: string) {
		this.data.memories ||= {};
		this.data.memories[owner] = [...(this.data.memories[owner] ?? []), note].slice(-20);
		await this.save();
	}

	async clearMemories(owner: string) {
		if (this.data.memories) {
			Reflect.deleteProperty(this.data.memories, owner);
		}

		await this.save();
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
