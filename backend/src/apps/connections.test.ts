import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	afterEach, describe, expect, it,
} from 'vitest';
import {ConnectionStore, type AppIdentity} from './connections.js';

const identity: AppIdentity = {
	image_path: 'C:/Apps/example.exe', process_id: 42, process_started: '1', version: '1',
};
const folders: string[] = [];
afterEach(async () => {
	await Promise.all(folders.splice(0).map(async (folder) => rm(folder, {recursive: true, force: true})));
});
async function store() {
	const folder = await mkdtemp(join(tmpdir(), 'pokemon-connections-'));
	folders.push(folder);
	return new ConnectionStore(join(folder, 'connections.json'));
}

describe('persistent application connections', () => {
	it('survives a new store/session and retains only connection metadata', async () => {
		const first = await store();
		await first.put('example', identity, {identity, updated_at: 0, cdp: {endpoint: 'http://127.0.0.1:9222', page_url: 'https://example.com/'}});
		const second = new ConnectionStore(first.file);
		expect(await second.get('example', {...identity, process_id: 100})).toMatchObject({cdp: {endpoint: 'http://127.0.0.1:9222/'}});
		expect(await second.get('other', identity)).toBeUndefined();
		expect(await second.get('example', {...identity, image_path: 'C:/Different/app.exe'})).toBeUndefined();
		expect(await readFile(first.file, 'utf8')).not.toMatch(/session_id|response_body|password|authorization/);
	});
	it('serializes competing writes and invalidates one source without removing another', async () => {
		const first = await store();
		const
			second = new ConnectionStore(first.file);
		await Promise.all([first.put('a', identity, {identity, updated_at: 0, cdp: {endpoint: 'http://127.0.0.1:9222'}}),
			second.put('b', identity, {
				identity, updated_at: 0, cdp: {endpoint: 'http://127.0.0.1:9333'}, capture: {file: 'C:/capture.json', filter: '/messages'},
			})]);
		expect((await first.get('a', identity))?.cdp).toBeTruthy();
		await first.invalidate('b', identity, 'cdp');
		expect(await second.get('b', identity)).toMatchObject({capture: {filter: '/messages'}});
		expect((await second.get('b', identity))?.cdp).toBeUndefined();
	});
});
