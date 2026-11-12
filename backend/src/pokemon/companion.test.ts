import {
	afterEach, expect, it, vi,
} from 'vitest';
import {DesktopCompanion, pokemonIds} from './companion.js';

afterEach(() => vi.unstubAllEnvs());

it.each(['hello-kitty', 'kuromi'])('accepts %s as the configured companion', (pet) => {
	vi.stubEnv('POKEMON_PET', pet);
	expect(pokemonIds).toContain(pet);
	expect(new DesktopCompanion().state.pet).toBe(pet);
});

it('allows a failed startup to recover and shares the retry between concurrent callers', async () => {
	vi.stubEnv('POKEMON_UI', 'on');
	const companion = new DesktopCompanion();
	const bridge = companion as unknown as {launch: () => Promise<void>; socket: {destroyed: boolean}};
	const launch = vi.spyOn(bridge, 'launch').mockRejectedValueOnce(new Error('Desktop exited'))
		.mockImplementationOnce(async () => {
			bridge.socket = {destroyed: false};
		});
	await expect(companion.start()).rejects.toThrow('Desktop exited');
	await Promise.all([companion.start(), companion.start()]);
	expect(launch).toHaveBeenCalledTimes(2);
});

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
