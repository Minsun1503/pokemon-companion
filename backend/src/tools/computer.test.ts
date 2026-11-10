import {
	afterEach, describe, expect, it, vi,
} from 'vitest';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {
	keyboard, providerRegistry, screen, mouse, Point,
} from '@nut-tree-fork/nut-js';
import sharp from 'sharp';
import {PokemonRuntime} from '../pokemon/runtime.js';
import {registerComputer} from './computer.js';
import {DesktopError} from '../utils/errors.js';

afterEach(() => vi.restoreAllMocks());

function fixture() {
	const runtime = new PokemonRuntime();
	vi.spyOn(runtime, 'computer').mockImplementation(async (_action, _coordinate, execute) => execute());
	const request = vi.spyOn(runtime.windows, 'request').mockResolvedValue({keyboard_layout: '00000409', language_id: '0409', imm_ime: false});
	const registerTool = vi.fn();
	registerComputer({registerTool} as unknown as McpServer, runtime);
	const rawHandle = registerTool.mock.calls[0]![2];
	const handle: typeof rawHandle = async (...args: Parameters<typeof rawHandle>) => {
		const result = await rawHandle(...args);
		if (result.isError) {
			const payload = JSON.parse(result.content[0].text);
			throw new DesktopError(payload.error, payload.error_details);
		}

		return result;
	};

	const controller = new AbortController();
	const native = vi.spyOn(providerRegistry.getKeyboard(), 'type').mockResolvedValue(undefined);
	const wrapper = vi.spyOn(keyboard, 'type').mockResolvedValue(keyboard);
	const press = vi.spyOn(keyboard, 'pressKey').mockResolvedValue(keyboard);
	const release = vi.spyOn(keyboard, 'releaseKey').mockResolvedValue(keyboard);
	return {
		runtime, controller, native, wrapper, request, press, release, handle, rawHandle, schema: registerTool.mock.calls[0]![1].inputSchema,
		type: async (text: string) => handle({action: 'type', text}, {signal: controller.signal}),
		input: async (action: 'key' | 'type', text: string, windowId: string) => handle({action, text, window_id: windowId}, {signal: controller.signal}),
		screenshot: async () => handle({action: 'get_screenshot'}, {signal: controller.signal}),
	};
}

describe.runIf(process.platform === 'win32')('plain Windows typing', () => {
	it('does not classify focus loss after a completed chunk as a safe full retry', async () => {
		const {rawHandle, request, native, controller} = fixture();
		let guards = 0;
		request.mockImplementation(async (args) => {
			if (args.action !== 'foreground') {
				return {status: 'available'};
			}

			guards += 1;
			return guards >= 3 ? {id: '456', root_owner_id: '456'} : {id: '123', root_owner_id: '123'};
		});
		const result = await rawHandle({action: 'type', text: '1234 '.repeat(100), window_id: '123'}, {signal: controller.signal});
		expect(JSON.parse(result.content[0].text)).toMatchObject({error_details: {code: 'FOREGROUND_MISMATCH', disposition: {retry: 'unsafe'}, progress: {submitted_characters: 32}}});
		expect(native).toHaveBeenCalledOnce();
	});

	it('returns partial typing evidence instead of allowing a full replay', async () => {
		const {rawHandle, native, controller} = fixture();
		native.mockImplementationOnce(async () => {
			controller.abort();
		});
		const result = await rawHandle({action: 'type', text: '1234 '.repeat(100)}, {signal: controller.signal});
		expect(result.isError).toBe(true);
		expect(JSON.parse(result.content[0].text)).toMatchObject({
			contract_version: 1, error_details: {
				code: 'CANCELLED', disposition: {delivery: 'delivery_uncertain', retry: 'unsafe'}, progress: {submitted_characters: 32, total_characters: 500},
			},
		});
		expect(native).toHaveBeenCalledOnce();
	});

	it('attempts modifier release after a partially failed key press', async () => {
		const {rawHandle, press, release, controller} = fixture();
		press.mockRejectedValueOnce(new Error('partial native press'));
		const result = await rawHandle({action: 'key', text: 'ctrl+l'}, {signal: controller.signal});
		expect(JSON.parse(result.content[0].text).error_details.disposition).toEqual({delivery: 'delivery_uncertain', retry: 'unsafe'});
		expect(release).toHaveBeenCalledOnce();
		expect(press).toHaveBeenCalledOnce();
	});

	it('keeps retry metadata through the actual MCP transport', async () => {
		const {runtime, press} = fixture();
		const server = new McpServer({name: 'test', version: '1'});
		registerComputer(server, runtime);
		const client = new Client({name: 'test', version: '1'});
		const [ct, st] = InMemoryTransport.createLinkedPair();
		await Promise.all([server.connect(st), client.connect(ct)]);
		try {
			press.mockRejectedValueOnce(new Error('lost native response'));
			const response = await client.callTool({name: 'computer', arguments: {action: 'key', text: 'ctrl+l'}}) as CallToolResult;
			expect(response.isError).toBe(true);
			const text = response.content.find((item) => item.type === 'text')!;
			expect(JSON.parse(text.text).error_details.disposition.retry).toBe('unsafe');
		} finally {
			await client.close();
			await server.close();
		}
	});

	it('sends text in order without changing keyboard calibration', async () => {
		const {native, wrapper, type} = fixture();
		const text = '1234 '.repeat(100);
		const delay = keyboard.config.autoDelayMs;
		const result = await type(text);
		expect(JSON.parse(result.content[0].text)).toMatchObject({verify: 'read the field to confirm the text; an active input method can alter letters', input_method: {keyboard_layout: '00000409', language_id: '0409', imm_ime: false}});
		expect(native.mock.calls.map(([part]) => part).join('')).toBe(text);
		expect(wrapper).not.toHaveBeenCalled();
		expect(keyboard.config.autoDelayMs).toBe(delay);
	});

	it.each(['pause', 'cancel', 'failure'])('handles %s during input-method observation without replaying input', async (reason) => {
		const {runtime, controller, native, type} = fixture();
		vi.mocked(runtime.windows.request).mockImplementationOnce(async () => {
			if (reason === 'pause') {
				runtime.companion.state.paused = true;
			} else if (reason === 'cancel') {
				controller.abort();
			}

			throw new Error('Metadata unavailable');
		});
		if (reason === 'failure') {
			const result = await type('12345');
			expect(JSON.parse(result.content[0].text).input_method).toEqual({status: 'unavailable'});
			expect(native).toHaveBeenCalledTimes(1);
		} else {
			await expect(type('12345')).rejects.toThrow('Computer action cancelled or paused before execution.');
			expect(native).not.toHaveBeenCalled();
		}
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
		await expect(type('12345')).rejects.toThrow(error.message);
		await type('one\0two');
		expect(wrapper).toHaveBeenCalledWith('one\0two');
		expect(native).toHaveBeenCalledTimes(1);
	});
});

describe.runIf(process.platform === 'win32')('foreground input guard', () => {
	it.each(['key', 'type'] as const)('blocks mismatched %s input without any key events', async (action) => {
		const {request, input, press, release, native} = fixture();
		request.mockResolvedValue({
			id: '456', root_owner_id: '456', title: 'Other window', process: 'test',
		});
		await expect(input(action, action === 'key' ? 'f8' : '7', '123')).rejects.toThrow('Other window (test, window 456). No input was sent.');
		expect(press).not.toHaveBeenCalled();
		expect(release).not.toHaveBeenCalled();
		expect(native).not.toHaveBeenCalled();
		expect(request.mock.calls.filter(([args]) => args.action === 'foreground')).toHaveLength(1);
	});

	it.each(['key', 'type'] as const)('allows exact and root-owner matches for %s', async (action) => {
		const {request, input, press, native} = fixture();
		for (const id of ['123', '456']) {
			request.mockResolvedValue({
				id, root_owner_id: '123', title: 'Target window', process: 'test',
			});
			// eslint-disable-next-line no-await-in-loop
			await input(action, action === 'key' ? 'f8' : '7', '123');
		}

		expect(action === 'key' ? press : native).toHaveBeenCalledTimes(2);
	});

	it.each(['key', 'type'] as const)('checks pause/cancellation before and after the %s guard', async (action) => {
		for (const reason of ['pause', 'cancel']) {
			for (const phase of ['before', 'after']) {
				const {runtime, controller, request, input, press, native} = fixture();
				const stop = () => {
					if (reason === 'pause') {
						runtime.companion.state.paused = true;
					} else {
						controller.abort();
					}
				};

				request.mockImplementation(async (args) => {
					if (args.action === 'foreground' && phase === 'after') {
						stop();
					}

					return {id: '123', root_owner_id: '123'};
				});
				if (phase === 'before') {
					stop();
				}

				// eslint-disable-next-line no-await-in-loop
				await expect(input(action, action === 'key' ? 'f8' : '7', '123')).rejects.toThrow('cancelled or paused before execution');
				expect(press).not.toHaveBeenCalled();
				expect(native).not.toHaveBeenCalled();
				expect(request.mock.calls.filter(([args]) => args.action === 'foreground')).toHaveLength(phase === 'before' ? 0 : 1);
				vi.restoreAllMocks();
			}
		}
	});

	it('restores the Unicode clipboard without sending key-up events on a mismatch', async () => {
		const {runtime, request, input, press, release} = fixture();
		const clipboard = vi.spyOn(runtime.companion, 'clipboard').mockResolvedValue(undefined);
		request.mockResolvedValue({id: '456', root_owner_id: '456'});
		await expect(input('type', 'Pokémon', '123')).rejects.toThrow('No input was sent');
		expect(clipboard.mock.calls).toEqual([['Pokémon'], [null]]);
		expect(press).not.toHaveBeenCalled();
		expect(release).not.toHaveBeenCalled();
	});

	it('does not replay a failed key press', async () => {
		const {request, input, press} = fixture();
		request.mockResolvedValue({id: '123', root_owner_id: '123'});
		const error = new Error('Native press failed');
		press.mockRejectedValueOnce(error);
		await expect(input('key', 'f8', '123')).rejects.toThrow(error.message);
		expect(press).toHaveBeenCalledOnce();
	});

	it('keeps the old schema and rejects invalid or unsupported window_id use', async () => {
		const {schema, handle, controller} = fixture();
		expect(schema.parse({action: 'key', text: 'ctrl+tab'})).toEqual({action: 'key', text: 'ctrl+tab'});
		expect(schema.safeParse({action: 'key', text: 'f8', window_id: 'invalid'}).success).toBe(false);
		await expect(handle({action: 'get_cursor_position', window_id: '123'}, {signal: controller.signal})).rejects.toThrow('only for Windows key and type');
	});
});

describe('screenshot output', () => {
	it.each([
		{
			width: 1920, height: 1080, cursor: [960, 540], expected: [1464, 823, 732, 411],
		},
		{
			width: 80, height: 60, cursor: [0, 0], expected: [80, 60, 0, 0],
		},
	])('preserves dimensions and clips the sharp crosshair: %j', async ({width, height, cursor, expected}) => {
		const {screenshot} = fixture();
		const data = Buffer.alloc(width * height * 4);
		for (let index = 0; index < data.length; index += 4) {
			data.set([20, 40, 60, 255], index);
		}

		vi.spyOn(screen, 'grab').mockResolvedValue({width, height, data} as Awaited<ReturnType<typeof screen.grab>>);
		vi.spyOn(screen, 'width').mockResolvedValue(width);
		vi.spyOn(screen, 'height').mockResolvedValue(height);
		vi.spyOn(mouse, 'getPosition').mockResolvedValue(new Point(cursor[0]!, cursor[1]!));
		const result = await screenshot();
		const image = result.content.find((item: {type: string}) => item.type === 'image');
		const {data: pixels, info} = await sharp(Buffer.from(image.data, 'base64')).ensureAlpha().raw().toBuffer({resolveWithObject: true});
		expect(info.width).toBe(expected[0]);
		expect(info.height).toBe(expected[1]);
		expect(JSON.parse(result.content[0].text)).toEqual({image_width: info.width, image_height: info.height});
		const [,, x, y] = expected;
		const pixel = (px: number, py: number) => {
			const offset = ((py * info.width) + px) * 4;
			return [...pixels.subarray(offset, offset + 4)];
		};

		expect(pixel(x!, y!)).toEqual([255, 0, 0, 255]);
		expect(pixel(x! + 20, y!)).toEqual([255, 0, 0, 255]);
		expect(pixel(x! + 20, y! + 1)).toEqual([255, 0, 0, 255]);
		expect(pixel(x! + 20, y! + 2)).toEqual([20, 40, 60, 255]);
		expect(pixel(x! + 21, y!)).toEqual([20, 40, 60, 255]);
	});
});
