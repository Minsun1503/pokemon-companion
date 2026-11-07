import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {
	mouse,
	keyboard,
	Point,
	screen,
	Button,
	imageToJimp,
	Key,
	providerRegistry,
} from '@nut-tree-fork/nut-js';
import {execFileSync} from 'node:child_process';
import {readFileSync, unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Jimp from 'jimp';
import sharp from 'sharp';
import {toKeys} from '../utils/xdotoolStringToKeys.js';
import {
	measure, measureSync, serialize, timedCall,
} from '../utils/timing.js';
import {jsonResult} from '../utils/response.js';
import type {PokemonRuntime} from '../pokemon/runtime.js';

/**
 * Grab the screen, falling back to the macOS `screencapture` CLI if nut-js fails
 * (e.g. on macOS 26+ where CGDisplayCreateImageForRect was removed).
 */
async function grabScreen(): Promise<ReturnType<typeof imageToJimp>> {
	try {
		return imageToJimp(await screen.grab());
	} catch {
		// Fallback: use screencapture CLI (macOS only)
		const tmpPath = join(tmpdir(), `computer-use-mcp-${Date.now()}.png`);
		try {
			execFileSync('screencapture', ['-x', tmpPath]);
			const buffer = readFileSync(tmpPath);
			return (await Jimp.read(buffer)) as unknown as ReturnType<typeof imageToJimp>;
		} finally {
			try {
				unlinkSync(tmpPath);
			} catch {
				/* ignore cleanup errors */
			}
		}
	}
}

// Configure nut-js
mouse.config.autoDelayMs = 100;
mouse.config.mouseSpeed = 1000;
keyboard.config.autoDelayMs = 10;

/**
 * Check if xdotool is available on this system.
 * Cached after first check.
 */
let xdotoolAvailable: boolean | undefined;
function hasXdotool(): boolean {
	if (xdotoolAvailable === undefined) {
		try {
			execFileSync('which', ['xdotool'], {stdio: 'ignore'});
			xdotoolAvailable = true;
		} catch {
			xdotoolAvailable = false;
		}
	}

	return xdotoolAvailable;
}

/**
 * Type text using xdotool, which correctly respects the X11 keyboard layout.
 *
 * nut-js's keyboard.type() uses libnut's typeString which maps characters to
 * X keycodes using a hardcoded US QWERTY lookup. This breaks when the X server's
 * keyboard layout differs, causing characters like : and ; to be swapped.
 * xdotool type uses XSendEvent with proper keymap lookups, so it works regardless
 * of the active keyboard layout.
 */
function xdotoolType(text: string): void {
	execFileSync('xdotool', [
		'type',
		'--clearmodifiers',
		'--delay',
		String(keyboard.config.autoDelayMs),
		'--',
		text,
	], {
		env: {...process.env, DISPLAY: process.env.DISPLAY || ':1'},
	});
}

// The Claude API automatically downsamples images larger than ~1.15MP or 1568px on the long edge.
// We already downsampled screenshots to fit these limits and reported the original screen
// dimensions via display_width_px/display_height_px, but Claude wasn't correctly using those
// reported dimensions - it was using coordinates from the downsampled image space directly.
// As a workaround, we now report the actual image dimensions and scale Claude's coordinates
// back up to logical screen coordinates.
// See: https://docs.anthropic.com/en/docs/build-with-claude/vision#evaluate-image-size
const maxLongEdge = 1568;
const maxPixels = 1.15 * 1024 * 1024; // 1.15 megapixels

/**
 * Calculate the scale factor to downsample an image to fit API limits.
 * Returns a value <= 1 representing how much to shrink the image.
 */
function getSizeToApiScale(width: number, height: number): number {
	const longEdge = Math.max(width, height);
	const totalPixels = width * height;

	const longEdgeScale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
	const pixelScale = totalPixels > maxPixels ? Math.sqrt(maxPixels / totalPixels) : 1;

	return Math.min(longEdgeScale, pixelScale);
}

/**
 * Get the scale factor from API image coordinates to logical screen coordinates.
 * This is the inverse of the downsampling we apply to fit API limits.
 */
async function getApiToLogicalScale(): Promise<number> {
	const logicalWidth = await screen.width();
	const logicalHeight = await screen.height();
	const apiScaleFactor = getSizeToApiScale(logicalWidth, logicalHeight);
	return 1 / apiScaleFactor;
}

// Define the action enum values
const ActionEnum = z.enum([
	'key',
	'type',
	'mouse_move',
	'left_click',
	'left_click_drag',
	'right_click',
	'middle_click',
	'double_click',
	'scroll',
	'get_screenshot',
	'get_cursor_position',
]);

const actionDescription = `The action to perform. The available actions are:
* key: Press one key or key-combination. Optional window_id blocks input if the target is not foreground (or root owner of foreground); it never activates the window.
* type: Type a string of text on the keyboard. A Vietnamese/IME keyboard layout can alter typed letters (for example Telex). Prefer windows set_value for fields; after type, verify the field with read_text.
* get_cursor_position: Get the current (x, y) pixel coordinate of the cursor on the screen.
* mouse_move: Move the cursor to a specified (x, y) pixel coordinate on the screen.
* left_click: Click the left mouse button. If coordinate is provided, moves to that position first.
* left_click_drag: Click and drag the cursor to a specified (x, y) pixel coordinate on the screen.
* right_click: Click the right mouse button. If coordinate is provided, moves to that position first.
* middle_click: Click the middle mouse button. If coordinate is provided, moves to that position first.
* double_click: Double-click the left mouse button. If coordinate is provided, moves to that position first.
* scroll: Scroll the screen in a specified direction. Requires coordinate (moves there first) and text parameter with direction: "up", "down", "left", or "right". Optionally append ":N" to scroll N pixels (default 300), e.g. "down:500".
* get_screenshot: Take a screenshot of the screen.`;

const toolDescription = 'Desktop mouse/keyboard control and screenshot fallback. On Windows FIRST use the windows tool for compact UI Automation inspection, control invocation, field values, and result verification. If its API lacks a control/pattern, prefer keyboard shortcuts; use screenshots only for visual-only or unsupported content. For coordinate clicks, inspect a fresh screenshot and use the returned image dimensions, not physical display pixels. A red crosshair marks the cursor; click control centers and verify results. On macOS an initial click may only focus a window. This is a desktop GUI interface, not a terminal. Pokémon animations update automatically. Respect user pauses. Shortcuts: use a known direct shortcut (ctrl+l address bar, ctrl+1..8 indexed tab, ctrl+9 last tab, escape dismiss, ctrl+, settings where supported) only after verifying the target is foreground, then verify the result immediately. Never use tab/ctrl+tab/alt+tab as blind navigation. Use windows focus for a known control.';

const coordinateSchema = z
	.array(z.number())
	.length(2)
	.describe('(x, y): The x (pixels from the left edge) and y (pixels from the top edge) coordinates');

export function registerComputer(server: McpServer, runtime: PokemonRuntime): void {
	server.registerTool(
		'computer',
		{
			title: 'Computer Control',
			description: toolDescription,
			inputSchema: z.object({
				action: ActionEnum.describe(actionDescription),
				coordinate: coordinateSchema.optional(),
				text: z.string().optional().describe('Text to type or key command to execute'),
				window_id: z.string().regex(/^\d+$/).optional().describe('Windows key/type only: require this foreground window or its owned dialog. No automatic activation. Focus can still change between the check and input; verify afterward.'),
			}).strict(),
			// Note: No outputSchema because this tool returns varying content types including images
			annotations: {
				readOnlyHint: false,
			},
		},
		async (args, extra) => timedCall('computer', args.action, async () => {
			const {action, coordinate, text, window_id: windowId} = args as {action: z.infer<typeof ActionEnum>; coordinate?: [number, number]; text?: string; window_id?: string};
			if (windowId !== undefined && (process.platform !== 'win32' || !['key', 'type'].includes(action))) {
				throw new Error('window_id is supported only for Windows key and type actions.');
			}

			// Scale coordinates from API image space to logical screen space
			let scaledCoordinate = coordinate;
			if (coordinate) {
				const scale = await getApiToLogicalScale();
				scaledCoordinate = [
					Math.round(coordinate[0] * scale),
					Math.round(coordinate[1] * scale),
				];

				// Validate coordinates are within display bounds
				const [x, y] = scaledCoordinate;
				const [width, height] = [await screen.width(), await screen.height()];
				if (x < 0 || x >= width || y < 0 || y >= height) {
					throw new Error(`Coordinates (${x}, ${y}) are outside display bounds of ${width}x${height}`);
				}
			}

			return runtime.computer(action, scaledCoordinate, async () => {
				const beforeInput = async () => {
					if (extra.signal.aborted || runtime.companion.state.paused) {
						throw new Error('Computer action cancelled or paused before execution.');
					}

					if (windowId !== undefined) {
						// shortcut: focus can change after this check; use app APIs when atomic targeting is required.
						await measure('foreground_guard', async () => runtime.windows.requireForeground(windowId, {
							signal: extra.signal, timeoutMs: 20_000, paused: () => runtime.companion.state.paused, timeoutError: 'Foreground check timed out. No input was sent; read the window again before continuing.',
						}));
					}

					if (extra.signal.aborted || runtime.companion.state.paused) {
						throw new Error('Computer action cancelled or paused before execution.');
					}
				};

				// Implement system actions using nut-js
				switch (action) {
					case 'key': {
						if (!text) {
							throw new Error('Text required for key');
						}

						const keys = toKeys(text);
						await beforeInput();
						await keyboard.pressKey(...keys);
						await keyboard.releaseKey(...keys);

						return jsonResult({ok: true});
					}

					case 'type': {
						if (!text) {
							throw new Error('Text required for type');
						}

						let inputMethod: Record<string, unknown> | undefined;
						if (process.platform === 'win32') {
							try {
								inputMethod = await runtime.windows.request({action: 'input_method'}, {
									signal: extra.signal, timeoutMs: 200, paused: () => runtime.companion.state.paused, timeoutError: 'Input method observation timed out.',
								});
							} catch {
								inputMethod = {status: 'unavailable'};
							}
						}

						if (extra.signal.aborted || runtime.companion.state.paused) {
							throw new Error('Computer action cancelled or paused before execution.');
						}

						if (process.platform === 'linux' && hasXdotool()) {
							xdotoolType(text);
						} else if (process.platform === 'win32' && [...text].some((character) => character.codePointAt(0)! > 127) && runtime.companion.clipboard) {
							await runtime.companion.clipboard(text);
							let pasteStarted = false;
							try {
								await beforeInput();
								pasteStarted = true;
								await keyboard.pressKey(Key.LeftControl, Key.V);
								await keyboard.releaseKey(Key.LeftControl, Key.V);
								await new Promise<void>((resolve) => {
									setTimeout(resolve, 200);
								});
							} finally {
								if (pasteStarted) {
									await keyboard.releaseKey(Key.LeftControl, Key.V);
								}

								await runtime.companion.clipboard(null);
							}
						} else if (process.platform === 'win32' && [...text].every((character) => character.codePointAt(0)! > 0 && character.codePointAt(0)! <= 127)) {
							await beforeInput();
							// Bypass per-character JS waits while yielding for pause/cancellation between chunks.
							for (let index = 0; index < text.length; index += 32) {
								if (extra.signal.aborted || runtime.companion.state.paused) {
									throw new Error(`Computer action cancelled. Submitted ${index} of ${text.length} characters; input methods may transform them. Read the field before continuing; do not retype from the start.`);
								}

								// eslint-disable-next-line no-await-in-loop
								await providerRegistry.getKeyboard().type(text.slice(index, index + 32));
								// eslint-disable-next-line no-await-in-loop
								await new Promise<void>((resolve) => {
									setImmediate(resolve);
								});
							}
						} else {
							await beforeInput();
							await keyboard.type(text);
						}

						return jsonResult({ok: true, verify: 'read the field to confirm the text; an active input method can alter letters', ...(inputMethod ? {input_method: inputMethod} : {})});
					}

					case 'get_cursor_position': {
						const pos = await mouse.getPosition();
						const scale = await getApiToLogicalScale();
						// Return coordinates in API image space (scaled down from logical)
						// so Claude can correlate with what it sees in screenshots
						return jsonResult({
							x: Math.round(pos.x / scale),
							y: Math.round(pos.y / scale),
						});
					}

					case 'mouse_move': {
						if (!scaledCoordinate) {
							throw new Error('Coordinate required for mouse_move');
						}

						await mouse.setPosition(new Point(scaledCoordinate[0], scaledCoordinate[1]));
						return jsonResult({ok: true});
					}

					case 'left_click': {
						if (scaledCoordinate) {
							await mouse.setPosition(new Point(scaledCoordinate[0], scaledCoordinate[1]));
						}

						await mouse.leftClick();
						return jsonResult({ok: true});
					}

					case 'left_click_drag': {
						if (!scaledCoordinate) {
							throw new Error('Coordinate required for left_click_drag');
						}

						await mouse.pressButton(Button.LEFT);
						await mouse.setPosition(new Point(scaledCoordinate[0], scaledCoordinate[1]));
						await mouse.releaseButton(Button.LEFT);
						return jsonResult({ok: true});
					}

					case 'right_click': {
						if (scaledCoordinate) {
							await mouse.setPosition(new Point(scaledCoordinate[0], scaledCoordinate[1]));
						}

						await mouse.rightClick();
						return jsonResult({ok: true});
					}

					case 'middle_click': {
						if (scaledCoordinate) {
							await mouse.setPosition(new Point(scaledCoordinate[0], scaledCoordinate[1]));
						}

						await mouse.click(Button.MIDDLE);
						return jsonResult({ok: true});
					}

					case 'double_click': {
						if (scaledCoordinate) {
							await mouse.setPosition(new Point(scaledCoordinate[0], scaledCoordinate[1]));
						}

						await mouse.doubleClick(Button.LEFT);
						return jsonResult({ok: true});
					}

					case 'scroll': {
						if (!scaledCoordinate) {
							throw new Error('Coordinate required for scroll');
						}

						if (!text) {
							throw new Error('Text required for scroll (direction like "up", "down:5")');
						}

						// Parse direction and optional amount from text (e.g. "down" or "down:5")
						const parts = text.split(':');
						const direction = parts[0];
						const amountStr = parts[1];
						const amount = amountStr ? parseInt(amountStr, 10) : 300;

						if (!direction) {
							throw new Error('Scroll direction required');
						}

						if (amountStr !== undefined && (isNaN(amount) || amount <= 0)) {
							throw new Error(`Invalid scroll amount: ${amountStr}`);
						}

						// Move to position first
						await mouse.setPosition(new Point(scaledCoordinate[0], scaledCoordinate[1]));

						// Scroll in the specified direction
						switch (direction.toLowerCase()) {
							case 'up':
								await mouse.scrollUp(amount);
								break;
							case 'down':
								await mouse.scrollDown(amount);
								break;
							case 'left':
								await mouse.scrollLeft(amount);
								break;
							case 'right':
								await mouse.scrollRight(amount);
								break;
							default:
								throw new Error(`Invalid scroll direction: ${direction}. Use "up", "down", "left", or "right"`);
						}

						return jsonResult({ok: true});
					}

					case 'get_screenshot': {
					// Get cursor position in logical coordinates
						const cursorPos = await mouse.getPosition();

						// Capture the entire screen (may be at Retina resolution)
						const image = await measure('screenshot_capture', grabScreen);

						// Then resize to fit within API limits
						const apiScaleFactor = getSizeToApiScale(image.getWidth(), image.getHeight());
						const imageWidth = Math.floor(image.getWidth() * apiScaleFactor);
						const imageHeight = Math.floor(image.getHeight() * apiScaleFactor);

						// Calculate cursor position in API image coordinates
						// cursor is in logical coords, need to convert to API image coords
						const scale = await getApiToLogicalScale();
						const cursorInImageX = Math.floor(cursorPos.x / scale);
						const cursorInImageY = Math.floor(cursorPos.y / scale);

						// Draw a crosshair at cursor position (red color)
						const crosshairSize = 20;
						const crosshairColor = 0xFF0000FF; // Red with full opacity (RGBA)
						const crosshair = new Jimp(imageWidth, imageHeight, 0x00000000);

						// Draw horizontal line
						for (let x = Math.max(0, cursorInImageX - crosshairSize); x <= Math.min(imageWidth - 1, cursorInImageX + crosshairSize); x++) {
							if (cursorInImageY >= 0 && cursorInImageY < imageHeight) {
								crosshair.setPixelColor(crosshairColor, x, cursorInImageY);
								// Make it thicker
								if (cursorInImageY > 0) {
									crosshair.setPixelColor(crosshairColor, x, cursorInImageY - 1);
								}

								if (cursorInImageY < imageHeight - 1) {
									crosshair.setPixelColor(crosshairColor, x, cursorInImageY + 1);
								}
							}
						}

						// Draw vertical line
						for (let y = Math.max(0, cursorInImageY - crosshairSize); y <= Math.min(imageHeight - 1, cursorInImageY + crosshairSize); y++) {
							if (cursorInImageX >= 0 && cursorInImageX < imageWidth) {
								crosshair.setPixelColor(crosshairColor, cursorInImageX, y);
								// Make it thicker
								if (cursorInImageX > 0) {
									crosshair.setPixelColor(crosshairColor, cursorInImageX - 1, y);
								}

								if (cursorInImageX < imageWidth - 1) {
									crosshair.setPixelColor(crosshairColor, cursorInImageX + 1, y);
								}
							}
						}

						// Resize before compositing so the calibrated crosshair stays sharp and three pixels thick.
						const optimizedBuffer = await measure('screenshot_encode_png', async () => sharp(image.bitmap.data, {
							raw: {width: image.getWidth(), height: image.getHeight(), channels: 4},
						})
							.resize(imageWidth, imageHeight, {fit: 'fill', kernel: 'linear'})
							.composite([{input: crosshair.bitmap.data, raw: {width: imageWidth, height: imageHeight, channels: 4}}])
							.png({quality: 80, compressionLevel: 9})
							.toBuffer());

						// Convert optimized buffer to base64
						const base64Data = measureSync('screenshot_base64', () => optimizedBuffer.toString('base64'));

						return {
							content: [
								{
									type: 'text',
									text: serialize({
									// Report the image dimensions - Claude should use coordinates within this space
									// These may differ from the actual display due to scaling for API limits
										image_width: imageWidth,
										image_height: imageHeight,
									}),
								},
								{
									type: 'image',
									data: base64Data,
									mimeType: 'image/png',
								},
							],
						};
					}
				}
			}, extra.signal);
		}),
	);
}
