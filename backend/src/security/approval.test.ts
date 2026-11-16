import {
	describe, expect, it, vi,
} from 'vitest';
import {approvalIntent, visibleText} from './approval.js';
import {PokemonRuntime} from '../pokemon/runtime.js';
import {browserSchema} from '../tools/browser.js';
import {appSchema} from '../apps/router.js';
import {windowsStepSchema} from '../windows/batch.js';

const intent = () => approvalIntent('browser', 'click', 'Send', 'https://example.test/thread/one', 'PRIVATE_MESSAGE', {navigation: 1}, {recipient: 'one'});
describe('server-derived approval digests and trust boundary', () => {
	it('changes the exact digest for target, path, input and observed-state changes', () => {
		const initial = intent();
		for (const changed of [approvalIntent('browser', 'press:Enter', 'Send', 'https://example.test/thread/one', 'PRIVATE_MESSAGE', {navigation: 1}, {recipient: 'one'}), approvalIntent('browser', 'click', 'Send', 'https://example.test/thread/two', 'PRIVATE_MESSAGE', {navigation: 1}, {recipient: 'two'}), approvalIntent('browser', 'click', 'Send', 'https://example.test/thread/one', 'changed', {navigation: 1}, {recipient: 'one'}), approvalIntent('browser', 'click', 'Send', 'https://example.test/thread/one', 'PRIVATE_MESSAGE', {navigation: 2}, {recipient: 'one'})]) {
			expect(changed.digest).not.toBe(initial.digest);
		}

		expect(initial.digest).not.toContain('PRIVATE_MESSAGE');
	});
	it('does not accept model-facing approval tokens, forged grants or private native protection commands', () => {
		expect(browserSchema.safeParse({action: 'click', action_id: 'b335700f-9205-44d1-8256-9533c301519f'}).success).toBe(false);
		for (const field of ['approved', 'approval_token', 'grant', 'authorization']) {
			expect(browserSchema.safeParse({action: 'click', [field]: 'forged'}).success).toBe(false);
			expect(appSchema.safeParse({action: 'api_get', app_id: 'fixture', [field]: 'forged'}).success).toBe(false);
		}

		expect(windowsStepSchema.safeParse({action: 'protect_companion', text: '{}'}).success).toBe(false);
	});
	it('caps hostile labels, escapes invisible controls, and refuses hidden input tails', () => {
		const request = approvalIntent('browser', 'click', `\u202e${'\n'.repeat(100000)}`, 'https://example.test/chat', '', {}, {}, {input: 'Complete draft'});
		expect(request.target.length).toBeLessThanOrEqual(200);
		expect(request.target_length).toBe(100001);
		expect(request.target).toContain('\\u202e');
		expect(Buffer.byteLength(JSON.stringify(request))).toBeLessThan(32768);
		expect(visibleText('\u0000\u0085\u200b\u2069')).toBe('\\u0000\\u0085\\u200b\\u2069');
		expect(() => approvalIntent('browser', 'fill', 'Editor', 'https://example.test', 'a'.repeat(8001), {}, {})).toThrow('display limit');
	});
	it('fails closed without companion, and rejects navigation between approval and dispatch', async () => {
		const runtime = new PokemonRuntime();
		const selected = intent();
		const refresh = vi.fn().mockResolvedValue(selected);
		vi.spyOn(runtime.companion, 'approve').mockResolvedValue({authorized: false, action_id: selected.action_id});
		await expect(runtime.authorize(selected, refresh)).rejects.toMatchObject({details: {code: 'APPROVAL_REQUIRED'}});
		expect(refresh).toHaveBeenCalledOnce();
		vi.mocked(runtime.companion.approve!).mockResolvedValue({authorized: true, action_id: selected.action_id});
		refresh.mockResolvedValue({...selected, digest: 'changed'});
		await expect(runtime.authorize(selected, refresh)).rejects.toMatchObject({details: {code: 'APPROVAL_STATE_CHANGED'}});
	});
});
