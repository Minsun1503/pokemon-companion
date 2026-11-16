import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {
	chmod, lstat, mkdir, readFile, rm, writeFile,
} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {rejectedAction} from '../utils/errors.js';

const execute = promisify(execFile);
/** Explicit lock: no concurrent stale-lock deletion that could steal a new owner's lock. */
export async function lockProfile(path: string) {
	const directory = resolve(path);
	await mkdir(directory, {recursive: true, mode: 0o700});
	if ((await lstat(directory)).isSymbolicLink()) {
		throw rejectedAction('INVALID_ARGS', 'Browser profile must not be a symbolic link.');
	}

	const file = join(directory, '.pokemon-owner');
	const owner = `${process.pid}:${randomUUID()}`;
	try {
		await writeFile(file, owner, {flag: 'wx', mode: 0o600});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
			throw error;
		}

		throw rejectedAction('PROFILE_BUSY', 'Another MCP process owns this browser profile, or left a crash lock. Use the existing process or another profile. Preserve the profile; remove .pokemon-owner only after verifying its process has exited.');
	}

	let releasing: Promise<void> | undefined;
	const release = async () => {
		releasing ??= (async () => {
			if (await readFile(file, 'utf8').catch(() => '') === owner) {
				await rm(file, {force: true});
			}
		})();
		await releasing;
	};

	try {
		if (process.platform === 'win32') {
			const {stdout} = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], {windowsHide: true, timeout: 10000});
			const sid = stdout.trim();
			if (!/^S-1-\d+(?:-\d+)+$/.test(sid)) {
				throw new Error('Cannot determine profile owner SID.');
			}

			await execute('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], {windowsHide: true, timeout: 10000});
		} else {
			await chmod(directory, 0o700);
		}

		return {directory, release};
	} catch (error) {
		await release();
		throw error;
	}
}
