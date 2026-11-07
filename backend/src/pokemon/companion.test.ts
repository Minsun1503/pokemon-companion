import {
	afterEach, expect, it, vi,
} from 'vitest';
import {DesktopCompanion} from './companion.js';

afterEach(() => vi.unstubAllEnvs());

it('coalesces rapid cosmetic updates and keeps only one bridge request in flight', async () => {
	vi.stubEnv('POKEMON_UI', 'on');
	const companion = new DesktopCompanion();
	let release: () => void = () => undefined;
	const send = vi.spyOn(companion as unknown as {send: (kind: string, data: Record<string, unknown>) => Promise<void>}, 'send')
		.mockImplementationOnce(async () => new Promise<void>((resolve) => {
			release = resolve;
		})).mockResolvedValue(undefined);
	companion.animate({message: 'first'}, [1, 2]);
	companion.animate({message: 'second'});
	await vi.waitFor(() => {
		expect(send).toHaveBeenCalledTimes(1);
	});
	expect(send.mock.calls[0]![1]).toMatchObject({state: {message: 'second'}, coordinate: [1, 2], cosmetic: true});
	companion.animate({message: 'third'});
	companion.animate({message: 'latest'});
	expect(send).toHaveBeenCalledTimes(1);
	release();
	await vi.waitFor(() => {
		expect(send).toHaveBeenCalledTimes(2);
	});
	expect(send.mock.calls[1]![1]).toMatchObject({state: {message: 'latest'}, cosmetic: true});
});
