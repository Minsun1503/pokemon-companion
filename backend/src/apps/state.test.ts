import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	afterAll, beforeAll, describe, expect, it,
} from 'vitest';
import {BrowserAutomation} from '../browser/automation.js';
import {appProfiles} from './catalog.js';
import {observeAppState} from './state.js';
import type {Page} from 'playwright';

let browser: BrowserAutomation;
let page: Page;
let directory: string;
beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'pokemon-app-state-'));
	browser = new BrowserAutomation();
	const opened = await browser.launch('chromium', true, directory);
	page = browser.page(opened.page_id);
}, 30000);
afterAll(async () => {
	await browser?.close();
	if (directory) {
		await rm(directory, {recursive: true, force: true});
	}
});
const fixtures: Record<string, {ready: string; auth: string}> = {
	teams: {ready: '<nav data-tid="app-bar">Chats</nav>', auth: '<input type="email" aria-label="Sign in">'},
	whatsapp: {ready: '<div id="pane-side">Chats</div>', auth: '<div data-ref="qr"><canvas></canvas></div>'},
	zalo: {ready: '<div id="conversationList">Chats</div>', auth: '<div class="qr-container">Scan QR</div>'},
};
describe('synthetic application state contracts (not real accounts)', () => {
	Object.entries(fixtures).forEach(([app, fixture]) => {
		it.each(['ready', 'auth_required', 'unavailable', 'layout_changed'])(`${app}: %s`, async (expected) => {
			const body = expected === 'ready' ? `${fixture.ready}<input type="password" hidden>` : expected === 'auth_required' ? fixture.auth : expected === 'unavailable' ? '<div id="outage">Offline</div>' : '<div>Unknown new layout</div>';
			await page.setContent(body);
			expect(await page.evaluate(observeAppState, {
				ready: appProfiles[app]!.ready, auth: appProfiles[app]!.unavailable, unavailable: '#outage', origin: 'null',
			})).toBe(expected);
		});
	});
});
