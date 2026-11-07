import {
	afterEach, describe, expect, it, vi,
} from 'vitest';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {keyboard, providerRegistry} from '@nut-tree-fork/nut-js';
import {PokemonRuntime} from '../pokemon/runtime.js';
import {registerComputer} from './computer.js';

afterEach(() => vi.restoreAllMocks());

function fixture() {
	const runtime = new PokemonRuntime();
	vi.spyOn(runtime, 'computer').mockImplementation(async (_action, _coordinate, execute) => execute());
	const registerTool = vi.fn();
	registerComputer({registerTool} as unknown as McpServer, runtime);
	const handle = registerTool.mock.calls[0]![2];
	const controller = new AbortController();
	const native = vi.spyOn(providerRegistry.getKeyboard(), 'type').mockResolvedValue(undefined);
	const wrapper = vi.spyOn(keyboard, 'type').mockResolvedValue(keyboard);
	return {
		runtime, controller, native, wrapper, type: async (text: string) => handle({action: 'type', text}, {signal: controller.signal}),
	};
}

describe.runIf(process.platform === 'win32')('plain Windows typing', () => {
	it('sends text in order without changing keyboard calibration', async () => {
		const {native, wrapper, type} = fixture();
		const text = '1234 '.repeat(100);
		const delay = keyboard.config.autoDelayMs;
		await type(text);
		expect(native.mock.calls.map(([part]) => part).join('')).toBe(text);
		expect(wrapper).not.toHaveBeenCalled();
		expect(keyboard.config.autoDelayMs).toBe(delay);
	});

	it.each(['pause', 'cancel'])('stops further input on %s between chunks', async (reason) => {
		const {runtime, controller, native, type} = fixture();
		native.mockImplementationOnce(async () => {
			if (reason === 'pause') {
				runtime.companion.state.paused = true;
			} else {
				controller.abort();
			}
		});
		await expect(type('1234 '.repeat(100))).rejects.toThrow('Computer action cancelled. Submitted 32 of 500 characters; input methods may transform them. Read the field before continuing; do not retype from the start.');
		expect(native).toHaveBeenCalledTimes(1);
	});

	it('preserves native errors and the fallback for embedded NUL', async () => {
		const {native, wrapper, type} = fixture();
		const error = new Error('Native input failed');
		native.mockRejectedValueOnce(error);
		await expect(type('12345')).rejects.toBe(error);
		await type('one\0two');
		expect(wrapper).toHaveBeenCalledWith('one\0two');
		expect(native).toHaveBeenCalledTimes(1);
	});
});
