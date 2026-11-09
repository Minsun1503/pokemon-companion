import {describe, expect, it, vi} from 'vitest';
import {isAgentDesktopAvailable, runCrossPlatformRequest} from './cross-platform.js';

describe('Cross-platform desktop automation', () => {
	it('checks agent-desktop availability without throwing', () => {
		const available = isAgentDesktopAvailable();
		expect(typeof available).toBe('boolean');
	});

	it('routes cross-platform requests gracefully', async () => {
		// Mock platform temporarily if needed
		if (process.platform === 'darwin' || process.platform === 'linux') {
			const result = await runCrossPlatformRequest({action: 'get_windows'});
			expect(result).toHaveProperty('windows');
		} else {
			// On Windows, verify unsupported platform rejection for non-darwin/non-linux if called directly
			const originalPlatform = process.platform;
			try {
				Object.defineProperty(process, 'platform', {value: 'unknown-os'});
				await expect(runCrossPlatformRequest({action: 'get_windows'})).rejects.toThrow('Unsupported desktop platform');
			} finally {
				Object.defineProperty(process, 'platform', {value: originalPlatform});
			}
		}
	});
});
