import {createDecipheriv} from 'node:crypto';
import {open, readFile, rm} from 'node:fs/promises';
import {protectCurrentUser} from '../learning/privacy.js';
import {z} from 'zod';

const envelope = z.object({
	version: z.literal(1), format: z.literal('pokemon-api-capture-aes-gcm'), expires_at: z.number(), data: z.string().max(6 * 1024 * 1024),
}).strict();
export async function decryptCapture(path: string, now = Date.now()) {
	const file = await open(path, 'r');
	let parsed;
	try {
		if (!(await file.stat()).isFile() || (await file.stat()).size > 6 * 1024 * 1024) {
			throw new Error('Encrypted API capture exceeds its size limit.');
		}

		parsed = envelope.parse(JSON.parse(await file.readFile('utf8')));
	} finally {
		await file.close();
	}

	if (parsed.expires_at <= now) {
		await rm(path, {force: true});
		throw new Error('API capture is stale; expired ciphertext was purged.');
	}

	if (parsed.expires_at > now + 305000) {
		throw new Error('API capture TTL exceeds five minutes.');
	}

	const savedKey = await readFile(`${path}.key`);
	const key = process.platform === 'win32' ? protectCurrentUser(savedKey, true) : savedKey;
	try {
		const bytes = Buffer.from(parsed.data, 'base64');
		const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
		decipher.setAAD(Buffer.from('pokemon-api-capture-v1'));
		decipher.setAuthTag(bytes.subarray(-16));
		return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8')) as unknown;
	} finally {
		key.fill(0);
	}
}
