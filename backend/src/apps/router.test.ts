import {
	describe, expect, it, vi,
} from 'vitest';
import {PokemonRuntime} from '../pokemon/runtime.js';
import {appSchema, routeApp} from './router.js';
import type {Page} from 'playwright';

const args = () => appSchema.parse({
	action: 'read', app_id: 'fixture', web_urls: ['https://example.com/'], web_ready_selector: '#messages',
	web_unavailable_selector: '#signin', desktop_query: 'Fixture',
});
describe('web-first routing', () => {
	it('rejects a catalog origin override before opening a browser or making a request', async () => {
		const runtime = new PokemonRuntime();
		const web = vi.spyOn(runtime.browser, 'webPage');
		await expect(routeApp(runtime, appSchema.parse({action: 'read', app_id: 'teams', web_urls: ['https://attacker.test/?data=synthetic']}))).rejects.toMatchObject({details: {code: 'INVALID_ARGS'}});
		expect(web).not.toHaveBeenCalled();
	});
	it('reads a ready web app through Playwright without any native discovery', async () => {
		const runtime = new PokemonRuntime();
		const page = {waitForFunction: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue('ready')} as unknown as Page;
		vi.spyOn(runtime.browser, 'webPage').mockResolvedValue({session_id: 'session', page_id: 'page', page});
		vi.spyOn(runtime.browser, 'snapshot').mockResolvedValue({
			page_id: 'page', url: 'https://example.com/', title: 'Example', nodes: [], matched: 0, truncated: false, text: {text: 'messages', truncated: false},
		});
		const native = vi.spyOn(runtime.windows, 'request');
		expect(await routeApp(runtime, args())).toMatchObject({surface: 'web', method: 'playwright'});
		expect(native).not.toHaveBeenCalled();
	});
	it('reports logged-out web access then looks for the desktop app', async () => {
		const runtime = new PokemonRuntime();
		const page = {waitForFunction: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue('auth_required')} as unknown as Page;
		vi.spyOn(runtime.browser, 'webPage').mockResolvedValue({session_id: 'session', page_id: 'page', page});
		const native = vi.spyOn(runtime.windows, 'request').mockResolvedValue({complete: true, windows: []});
		expect(await routeApp(runtime, args())).toMatchObject({surface: 'unavailable', web_attempts: [{available: false}]});
		expect(native.mock.calls.map((call) => call[0].action)).toEqual(['get_windows']);
	});
	it('does not fall through after a user pause, or choose an ambiguous desktop window', async () => {
		const runtime = new PokemonRuntime();
		runtime.companion.state.paused = true;
		const web = vi.spyOn(runtime.browser, 'webPage');
		await expect(routeApp(runtime, args())).rejects.toThrow('paused');
		expect(web).not.toHaveBeenCalled();
		runtime.companion.state.paused = false;
		web.mockRejectedValue(new Error('unreachable'));
		vi.spyOn(runtime.windows, 'request').mockResolvedValue({complete: true, windows: [{id: '1'}, {id: '2'}]});
		await expect(routeApp(runtime, args())).rejects.toThrow('Multiple desktop windows');
	});
});
