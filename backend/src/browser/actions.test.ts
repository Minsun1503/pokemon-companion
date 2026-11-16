import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {
	afterEach, describe, expect, it, vi,
} from 'vitest';
import {LocalJournal} from '../learning/privacy.js';
import {ActionJournal, actionDigest} from './actions.js';
import {lockProfile} from './profile.js';

const folders: string[] = [];
afterEach(async () => {
	await Promise.all(folders.splice(0).map(async (folder) => rm(folder, {recursive: true, force: true})));
});
async function folder() {
	const path = await mkdtemp(join(tmpdir(), 'pokemon-action-tests-'));
	folders.push(path);
	return path;
}

describe('durable uncertain action handling', () => {
	it('blocks changed input for an uncertain scope across restart, and persists trusted reconciliation', async () => {
		const directory = await folder();
		const key = randomBytes(32);
		const journal = new ActionJournal(new LocalJournal(directory, key));
		await journal.run('first-input', async () => 'unknown', () => false, undefined, 'thread-A');
		await journal.close();
		const reopened = new ActionJournal(new LocalJournal(directory, key));
		const dispatch = vi.fn();
		for (let index = 0; index < 20; index++) {
			// eslint-disable-next-line no-await-in-loop -- Assert each changed input remains blocked by the same persisted scope.
			await expect(reopened.run(`changed-input-${index}`, dispatch, () => true, undefined, 'thread-A')).rejects.toThrow('unknown outcome');
		}

		expect(dispatch).not.toHaveBeenCalled();
		await reopened.reconcile('thread-A');
		await reopened.close();
		const reconciled = new ActionJournal(new LocalJournal(directory, key));
		expect(await reconciled.blocked('thread-A')).toBe(false);
		await reconciled.close();
	});
	it('blocks 20 after-dispatch failures without any double send, including after restart', async () => {
		const path = await folder();
		const key = randomBytes(32);
		const journal = new ActionJournal(new LocalJournal(path, key));
		let sent = 0;
		for (let index = 0; index < 20; index += 1) {
			const digest = actionDigest(['send', index, 'PRIVATE_INPUT']);
			// eslint-disable-next-line no-await-in-loop, @typescript-eslint/no-loop-func -- Twenty sequential dispatch/drop/replay cycles share the observed send counter.
			await expect(journal.run(digest, async () => {
				sent += 1;
				throw new Error('Transport dropped after delivery');
			}, () => false)).rejects.toMatchObject({details: {code: 'ACTION_OUTCOME_UNKNOWN', disposition: {retry: 'unsafe'}}});
			const replay = vi.fn();
			// eslint-disable-next-line no-await-in-loop -- Verify each failed dispatch before starting the next cycle.
			await expect(journal.run(digest, replay, () => true)).rejects.toMatchObject({details: {code: 'REPLAY_BLOCKED'}});
			expect(replay).not.toHaveBeenCalled();
		}

		expect(sent).toBe(20);
		await journal.close();
		const reopened = new ActionJournal(new LocalJournal(path, key));
		const replay = vi.fn();
		await expect(reopened.run(actionDigest(['send', 0, 'PRIVATE_INPUT']), replay, () => true)).rejects.toThrow('unknown outcome');
		expect(replay).not.toHaveBeenCalled();
		expect(await readFile(join(path, 'events.enc'), 'utf8')).not.toContain('PRIVATE_INPUT');
		await reopened.close();
	});
	it('reserves an intent before concurrent requests can dispatch it twice', async () => {
		const journal = new ActionJournal(new LocalJournal(await folder(), randomBytes(32)));
		const dispatch = vi.fn().mockResolvedValue('observed');
		const outcomes = await Promise.allSettled([journal.run('same', dispatch, () => false), journal.run('same', dispatch, () => false)]);
		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
		await journal.close();
	});
});
describe('persistent profile ownership', () => {
	it('allows exactly one owner among 50 concurrent starts and releases only its own lock', async () => {
		const path = await folder();
		const contenders = await Promise.allSettled(Array.from({length: 50}, async () => lockProfile(path)));
		const winners = contenders.filter((result) => result.status === 'fulfilled');
		expect(winners).toHaveLength(1);
		expect(contenders.filter((result) => result.status === 'rejected')).toHaveLength(49);
		const owner = (winners[0]!).value;
		await owner.release();
		const next = await lockProfile(path);
		await owner.release();
		await expect(lockProfile(path)).rejects.toMatchObject({details: {code: 'PROFILE_BUSY'}});
		await next.release();
	}, 20000);
});
