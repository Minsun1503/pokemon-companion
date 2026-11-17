import {
	mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
	afterEach, describe, expect, it,
} from 'vitest';
import {bundledChromium} from './bundled.js';

const folders: string[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) {
		rmSync(folder, {recursive: true, force: true});
	}
});
function fixture() {
	const scratch = mkdtempSync(join(tmpdir(), 'pokemon-bundled-browser-'));
	folders.push(scratch);
	const backend = join(scratch, 'backend');
	const core = join(backend, 'node_modules/playwright-core');
	const cache = join(core, '.local-browsers');
	mkdirSync(join(cache, 'chromium'), {recursive: true});
	mkdirSync(join(backend, 'node_modules/playwright'), {recursive: true});
	writeFileSync(join(backend, 'package.json'), '{}');
	writeFileSync(join(core, 'package.json'), JSON.stringify({name: 'playwright-core', exports: {'./package.json': './package.json'}}));
	writeFileSync(join(backend, 'node_modules/playwright/package.json'), JSON.stringify({name: 'playwright', version: 'test-version', exports: {'./package.json': './package.json'}}));
	const manifest = {
		format: 1, playwright_version: 'test-version', platform: process.platform, arch: process.arch, executable: 'chromium/browser',
	};
	const file = join(cache, 'pokemon-browser.json');
	writeFileSync(file, JSON.stringify(manifest));
	writeFileSync(join(cache, manifest.executable), 'fixture binary');
	return {
		scratch, backend, cache, file, manifest,
	};
}

describe('portable Chromium bundle', () => {
	it('resolves its own executable after the package is moved', () => {
		const value = fixture();
		expect(bundledChromium(value.backend)).toBe(join(value.cache, value.manifest.executable));
		const moved = join(value.scratch, 'moved-backend');
		renameSync(value.backend, moved);
		expect(bundledChromium(moved)).toBe(join(moved, 'node_modules/playwright-core/.local-browsers/chromium/browser'));
	});
	it.each([
		{playwright_version: 'wrong-version'},
		{platform: 'wrong-platform'},
		{arch: 'wrong-arch'},
		{executable: '../../../outside'},
		{executable: process.execPath},
		{executable: 'chromium/missing'},
	])('rejects an incompatible or incomplete browser rather than using an external cache: %j', (change) => {
		const value = fixture();
		writeFileSync(value.file, JSON.stringify({...value.manifest, ...change}));
		expect(() => bundledChromium(value.backend)).toThrow('Bundled Chromium is unavailable');
	});
	it('reports a missing manifest and an empty binary as unavailable', () => {
		const value = fixture();
		writeFileSync(join(value.cache, value.manifest.executable), '');
		expect(() => bundledChromium(value.backend)).toThrow('unavailable');
		rmSync(value.file);
		expect(() => bundledChromium(value.backend)).toThrow('complete package');
	});
});
