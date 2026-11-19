import {randomInt, randomBytes} from 'node:crypto';
import {readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {loadConfig, saveConfig} from './config.js';

/**
 * Hermes-style DM pairing. An unknown Telegram user receives a short code; the
 * computer owner approves it locally with `npm run agent -- pairing approve CODE`.
 * Pending codes live in a plain file so the running gateway and the CLI can share
 * them without contending for the encrypted single-writer store.
 */
export type PendingPairing = {code: string; userId: string; name: string; createdAt: number};
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 0/O/1/I confusion.
export const pairingTtlMs = 60 * 60 * 1000;
const maxPending = 3;

function pairingFile(home: string) {
	return join(home, 'pairing.json');
}

async function readPending(home: string, now = Date.now()): Promise<PendingPairing[]> {
	try {
		const data = JSON.parse(await readFile(pairingFile(home), 'utf8')) as {pending?: PendingPairing[]};
		return (data.pending ?? []).filter((item) => typeof item.code === 'string' && /^\d+$/.test(item.userId) && now - item.createdAt < pairingTtlMs);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return [];
		}

		throw error;
	}
}

async function writePending(home: string, pending: PendingPairing[]) {
	const temporary = join(home, `pairing-${randomBytes(6).toString('hex')}.tmp`);
	await writeFile(temporary, JSON.stringify({pending}, null, 2), {mode: 0o600});
	await rename(temporary, pairingFile(home));
}

function newCode() {
	return Array.from({length: 8}, () => alphabet[randomInt(alphabet.length)]).join('');
}

/** Returns the user's live code (reused) or a new one; undefined when too many are waiting. */
export async function requestPairing(home: string, userId: string, name: string, now = Date.now()) {
	const pending = await readPending(home, now);
	const existing = pending.find((item) => item.userId === userId);
	if (existing) {
		return {code: existing.code, created: false};
	}

	if (pending.length >= maxPending) {
		return undefined;
	}

	const item = {
		code: newCode(), userId, name: name.slice(0, 64), createdAt: now,
	};
	await writePending(home, [...pending, item]);
	return {code: item.code, created: true};
}

export async function listPairing(home: string) {
	return readPending(home);
}

/** Moves the code's user into the owner allowlist. The first approved user becomes the owner. */
export async function approvePairing(home: string, code: string) {
	const normalized = code.trim().toUpperCase();
	const pending = await readPending(home);
	const match = pending.find((item) => item.code === normalized);
	if (!match) {
		throw new Error('Mã ghép cặp không đúng hoặc đã hết hạn (1 giờ). Nhắn lại bot để nhận mã mới.');
	}

	const config = await loadConfig(home);
	if (!config.telegram.allowedUsers.includes(match.userId)) {
		config.telegram.allowedUsers = [...config.telegram.allowedUsers, match.userId].slice(-20);
	}

	config.telegram.enabled = true;
	await saveConfig(home, config);
	await writePending(home, pending.filter((item) => item !== match));
	return match;
}

export async function revokeUser(home: string, userId: string) {
	const config = await loadConfig(home);
	const before = config.telegram.allowedUsers.length;
	config.telegram.allowedUsers = config.telegram.allowedUsers.filter((id) => id !== userId);
	await saveConfig(home, config);
	return before !== config.telegram.allowedUsers.length;
}
