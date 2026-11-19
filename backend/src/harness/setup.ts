/* eslint-disable no-await-in-loop -- The wizard asks one question at a time. */
import {createInterface} from 'node:readline';
import {type HarnessConfig, saveConfig} from './config.js';
import {type HarnessStore} from './store.js';
import {checkModelConnection, checkTelegramConnection} from './connections.js';

type Io = {ask: (question: string, secret?: boolean) => Promise<string>; say: (text: string) => void; close: () => void};

/** Terminal prompts. Secret answers are shown as * so typing and pasting are visible but the value is not. */
export function terminalIo(): Io {
	const rl = createInterface({input: process.stdin, output: process.stdout, terminal: true});
	let secretPrompt: string | undefined;
	const internal = rl as unknown as {_writeToOutput: (value: string) => void; output: NodeJS.WriteStream; line: string};
	internal._writeToOutput = (value: string) => {
		if (secretPrompt === undefined || /^(\r?\n)+$/.test(value)) {
			internal.output.write(value);
			return;
		}

		// Redraw the whole line with a mask instead of the typed characters.
		internal.output.write(`\r\u001B[K${secretPrompt}${'*'.repeat(Math.min(internal.line.length, 60))}${internal.line.length > 60 ? ` (${internal.line.length})` : ''}`);
	};

	return {
		ask: async (question, secret = false) => new Promise((resolve) => {
			secretPrompt = secret ? question : undefined;
			rl.question(question, (answer) => {
				secretPrompt = undefined;
				resolve(answer.trim());
			});
		}),
		say(text) {
			console.log(text);
		},
		close() {
			rl.close();
		},
	};
}

function yes(answer: string, fallback: boolean) {
	return answer ? /^(y|yes|c|có|co|ok)$/i.test(answer) : fallback;
}

/**
 * Hermes-style setup: model key → model check → Telegram bot token → done.
 * Users are authorized afterwards by DM pairing, so no user/group IDs are asked.
 */
export async function runSetup(home: string, config: HarnessConfig, store: HarnessStore, io: Io, request: typeof fetch = fetch) {
	io.say('\n=== Pokémon Agent setup ===\nNhấn Enter để giữ giá trị hiện có. Key/token được mã hóa trên máy này.\n');

	// 1. Model provider (DeepSeek by default; the route list stays editable in config.json).
	const routeName = config.routes[config.defaultRoute] ? config.defaultRoute : Object.keys(config.routes)[0]!;
	const route = config.routes[routeName]!;
	io.say(`[1/3] Model: ${route.label} (${route.baseUrl})`);
	for (;;) {
		const existing = Boolean(store.secret(route.keyEnv));
		const key = await io.ask(`API key ${existing ? '(Enter = giữ key đã lưu)' : ''}: `, true);
		if (key) {
			await store.putSecrets({[route.keyEnv]: key});
		} else if (!existing) {
			io.say('Cần API key để chạy agent.');
			continue;
		}

		try {
			const check = await checkModelConnection(config, store, routeName, request);
			const preferred = [route.model, 'deepseek-flash', 'deepseek-chat'].find((id) => id && check.models.includes(id)) ?? check.models[0] ?? '';
			io.say(`  ✓ Key hợp lệ. Model có sẵn: ${check.models.slice(0, 12).join(', ') || '(không liệt kê)'}`);
			const chosen = await io.ask(`  Model [${preferred}]: `) || preferred;
			if (!chosen) {
				io.say('  Nhập một model ID.');
				continue;
			}

			if (check.models.length && !check.models.includes(chosen)) {
				io.say(`  ✗ ${chosen} không có trong danh sách trên.`);
				continue;
			}

			route.model = chosen;
			config.defaultRoute = routeName;
			break;
		} catch (error) {
			io.say(`  ✗ ${error instanceof Error ? error.message : 'Không kết nối được.'} Kiểm tra key/số dư rồi nhập lại.`);
			await store.putSecrets({[route.keyEnv]: ''});
		}
	}

	await saveConfig(home, config);

	// 2. Telegram bot token, verified with getMe (never getUpdates, which would compete with a gateway).
	io.say('\n[2/3] Telegram bot\n  Tạo bot: mở @BotFather → /newbot → copy token.');
	let botName = '';
	for (;;) {
		const existing = Boolean(store.secret('TELEGRAM_BOT_TOKEN'));
		const token = await io.ask(`  Bot token ${existing ? '(Enter = giữ token đã lưu)' : ''}: `, true);
		if (token) {
			if (!/^\d+:[\w-]{30,}$/.test(token)) {
				io.say('  ✗ Token không đúng dạng 123456:ABC…');
				continue;
			}

			await store.putSecrets({TELEGRAM_BOT_TOKEN: token});
		} else if (!existing) {
			io.say('  Cần bot token. Hoặc nhấn Ctrl+C để dừng.');
			continue;
		}

		try {
			const check = await checkTelegramConnection(config, store, request);
			botName = typeof check.botUsername === 'string' ? check.botUsername : '';
			io.say(`  ✓ Bot @${botName} (${typeof check.displayName === 'string' ? check.displayName : ''})${check.webhookConfigured ? '\n  ⚠ Bot đang có webhook; gateway dùng polling nên sẽ không nhận tin cho tới khi xóa webhook.' : ''}`);
			break;
		} catch {
			io.say('  ✗ Telegram không chấp nhận token này. Copy lại token từ @BotFather.');
			await store.putSecrets({TELEGRAM_BOT_TOKEN: ''});
		}
	}

	config.telegram.enabled = true;
	await saveConfig(home, config);

	// 3. Pairing and background service are separate commands, like Hermes.
	io.say(`\n[3/3] Xong phần cấu hình.\n  1. Chạy bot:            npm run agent -- gateway\n  2. Nhắn riêng cho @${botName || 'bot'} trên Telegram, bot trả về mã ghép cặp.\n  3. Duyệt mã:            npm run agent -- pairing approve <MÃ>\n  Chạy nền khi đăng nhập: npm run agent -- gateway install\n`);
	return {botUsername: botName, installService: yes(await io.ask('Cài chạy nền khi đăng nhập Windows và khởi động ngay? [Y/n]: '), true)};
}
