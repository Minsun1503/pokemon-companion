import {
	afterEach, describe, expect, it, vi,
} from 'vitest';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {
	keyboard, providerRegistry, screen, mouse, Point,
} from '@nut-tree-fork/nut-js';
import sharp from 'sharp';
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
		screenshot: async () => handle({action: 'get_screenshot'}, {signal: controller.signal}),
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
