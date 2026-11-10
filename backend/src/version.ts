import {readFileSync} from 'node:fs';

/** The integration manifest owns the app version; isolated bundles stamp it into backend/package.json. */
function readVersion(): string {
	try {
		const project = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {name: string; version: string};
		if (project.name === 'pokemon-computer-companion') {
			return project.version;
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
	}

	return String((JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {version: string}).version);
}

export const serverVersion = readVersion();
