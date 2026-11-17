import {readFileSync, statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {
	dirname, isAbsolute, join, relative, resolve,
} from 'node:path';
import {fileURLToPath} from 'node:url';
import {rejectedAction} from '../utils/errors.js';

/** Resolve relative to this backend, including after a portable package is moved. */
export function bundledChromium(backend = resolve(dirname(fileURLToPath(import.meta.url)), '../..')): string {
	try {
		const fromBackend = createRequire(join(backend, 'package.json'));
		const cache = join(dirname(fromBackend.resolve('playwright-core/package.json')), '.local-browsers');
		const manifest = JSON.parse(readFileSync(join(cache, 'pokemon-browser.json'), 'utf8')) as {
			format: number; playwright_version: string; platform: string; arch: string; executable: string;
		};
		if (manifest.format !== 1 || manifest.playwright_version !== (fromBackend('playwright/package.json') as {version: string}).version
			|| manifest.platform !== process.platform || manifest.arch !== process.arch || typeof manifest.executable !== 'string' || isAbsolute(manifest.executable)) {
			throw new Error('Browser manifest does not match this Playwright version or platform.');
		}

		const executable = resolve(cache, manifest.executable);
		const within = relative(cache, executable);
		if (!within || within.startsWith('..') || isAbsolute(within) || !statSync(executable).isFile() || !statSync(executable).size) {
			throw new Error('Browser executable is missing or outside its package.');
		}

		return executable;
	} catch (error) {
		throw rejectedAction('BROWSER_UNAVAILABLE', `Bundled Chromium is unavailable: ${error instanceof Error ? error.message : String(error)} Obtain the complete package for this platform, or run npm run setup in a source checkout.`);
	}
}
