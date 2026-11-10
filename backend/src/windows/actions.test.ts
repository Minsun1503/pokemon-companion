import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {windowsActions, windowsActionCatalog, isReadOnlyNativeAction} from './actions.js';

describe('Windows action contract', () => {
	it('covers each public action in native dispatch or the polling layer', () => {
		const dispatcher = readFileSync(new URL('./uia-worker.ps1', import.meta.url), 'utf8');
		const controlDispatch = readFileSync(new URL('./uia-worker.cs', import.meta.url), 'utf8');
		for (const action of windowsActions) {
			if (action === 'wait_for') {
				continue;
			}

			expect(dispatcher.includes(`'${action}'`) || controlDispatch.includes(`case "${action}"`) || controlDispatch.includes(`action == "${action}"`), action).toBe(true);
			expect(isReadOnlyNativeAction(action)).toBe(!windowsActionCatalog[action].mutates);
		}
	});
});
