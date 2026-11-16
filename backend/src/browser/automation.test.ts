import {describe, expect, it} from 'vitest';
import {BrowserAutomation, loopbackEndpoint} from './automation.js';
import {browserSchema} from '../tools/browser.js';

describe('browser boundaries', () => {
	it('allows only local CDP addresses without credentials', () => {
		expect(loopbackEndpoint('http://127.0.0.1:9222')).toBe('http://127.0.0.1:9222/');
		expect(loopbackEndpoint('ws://[::1]:9222/devtools/browser/id')).toContain('[::1]');
		for (const endpoint of ['https://example.com', 'http://example.com:9222', 'file:///secret', 'http://user:secret@localhost:9222']) {
			expect(() => loopbackEndpoint(endpoint)).toThrow();
		}
	});
	it('rejects unknown pages, expired refs and unsupported actions without input', async () => {
		const browser = new BrowserAutomation();
		expect(() => browser.page('unknown')).toThrow('unknown');
		await expect(browser.target('unknown', 'missing')).rejects.toMatchObject({details: {code: 'STALE_REF'}});
		expect(browserSchema.safeParse({action: 'evaluate', code: 'unsafe()'}).success).toBe(false);
		expect(browserSchema.parse({action: 'launch'}).channel).toBe('chromium');
	});
});
