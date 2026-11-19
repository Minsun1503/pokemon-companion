import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {LocalJournal} from '../learning/privacy.js';
import {harnessHome, loadConfig} from './config.js';
import {HarnessStore} from './store.js';
import {GatewayApprovals} from './approvals.js';
import {HarnessEngine} from './engine.js';
import {harnessRuntime} from './runtime.js';
import {TelegramGateway} from './telegram.js';
import {
	approvePairing, listPairing, requestPairing, revokeUser,
} from './pairing.js';
import {runSetup, terminalIo} from './setup.js';
import {
	controlService, installService, serviceState, uninstallService,
} from './service.js';

const usage = `Pokémon Agent
  npm run agent -- setup                     Cài đặt: API key, model, Telegram bot token
  npm run agent -- gateway                   Chạy bot Telegram (cửa sổ này)
  npm run agent -- gateway install|uninstall Cài/gỡ chạy nền khi đăng nhập Windows
  npm run agent -- gateway start|stop|status Điều khiển bản chạy nền
  npm run agent -- pairing list              Xem mã ghép cặp đang chờ
  npm run agent -- pairing approve <MÃ>      Cho phép người dùng Telegram
  npm run agent -- pairing revoke <USER_ID>  Thu hồi quyền
  npm run agent -- status                    Trạng thái cấu hình
  npm run agent -- check                     Kiểm tra công cụ Pokémon trên máy`;

async function openStore(home: string) {
	const store = new HarnessStore(new LocalJournal(join(home, 'store')));
	try {
		await store.open();
	} catch (error) {
		if (/lock|writer|owns|EBUSY|EEXIST/i.test(error instanceof Error ? error.message : '')) {
			throw new Error('Một tiến trình agent khác (gateway hoặc một cửa sổ setup chưa đóng) đang giữ kho dữ liệu. Đóng cửa sổ đó, hoặc chạy: npm.cmd run agent -- gateway stop');
		}

		throw error;
	}

	return store;
}

export async function main(mode: string, root: string, args: string[] = []) {
	let deepSeekOnly = false;
	try {
		const profile = JSON.parse(await readFile(join(root, 'agent-profile.json'), 'utf8')) as {id: string};
		if (profile.id !== 'deepseek-telegram') {
			throw new Error('Unknown agent deployment profile.');
		}

		deepSeekOnly = true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
	}

	if (deepSeekOnly && !process.env.POKEMON_HARNESS_HOME) {
		process.env.POKEMON_HARNESS_HOME = join(process.env.LOCALAPPDATA || homedir(), 'pokemon-companion', 'harness-deepseek');
	}

	const home = harnessHome();
	const config = await loadConfig(home, deepSeekOnly);
	const [sub, value] = args;

	if (mode === 'help' || mode === '--help' || mode === '-h') {
		console.log(usage);
		return;
	}

	if (mode === 'pairing') {
		if (sub === 'approve' && value) {
			const user = await approvePairing(home, value);
			console.log(`✓ Đã cho phép ${user.name || 'người dùng'} (Telegram ID ${user.userId}). Họ có thể nhắn bot ngay, không cần khởi động lại.`);
		} else if (sub === 'revoke' && value) {
			console.log(await revokeUser(home, value) ? `Đã thu hồi quyền của ${value}.` : `${value} không có trong danh sách.`);
		} else {
			const pending = await listPairing(home);
			console.log(`Người dùng được phép: ${config.telegram.allowedUsers.join(', ') || '(chưa có)'}\nMã chờ duyệt:\n${pending.map((item) => `  ${item.code}  ${item.name || ''} (ID ${item.userId})`).join('\n') || '  (không có)'}`);
		}

		return;
	}

	if (mode === 'gateway' && sub && sub !== 'run') {
		if (sub === 'install') {
			console.log(await installService(root));
		} else if (sub === 'uninstall') {
			console.log(await uninstallService());
		} else if (sub === 'start' || sub === 'stop') {
			console.log(await controlService(sub));
		} else if (sub === 'status') {
			console.log(`Gateway chạy nền: ${await serviceState()}`);
		} else {
			throw new Error(usage);
		}

		return;
	}

	if (mode === 'status') {
		const store = await openStore(home);
		const route = config.routes[config.defaultRoute];
		console.log(JSON.stringify({
			home, defaultRoute: config.defaultRoute, model: route?.model, modelKey: Boolean(route && store.secret(route.keyEnv)),
			telegram: {
				enabled: config.telegram.enabled, token: Boolean(store.secret('TELEGRAM_BOT_TOKEN')), pairedUsers: config.telegram.allowedUsers.length, groups: config.telegram.allowedGroups.length,
			},
			service: await serviceState(),
		}, null, 2));
		await store.close();
		return;
	}

	if (mode === 'setup') {
		const store = await openStore(home);
		const io = terminalIo();
		let install = false;
		try {
			install = (await runSetup(home, config, store, io)).installService;
		} finally {
			io.close();
			await store.close();
		}

		if (install) {
			try {
				console.log(await installService(root));
			} catch (error) {
				console.error(`Không cài được chạy nền: ${error instanceof Error ? error.message : 'lỗi không rõ'}. Chạy tay: npm run agent -- gateway`);
			}
		}

		return;
	}

	if (!['gateway', 'run', 'check'].includes(mode)) {
		throw new Error(usage);
	}

	const store = await openStore(home);
	process.env.POKEMON_FRONTEND_DIR = join(root, 'frontend');
	process.env.POKEMON_ACTIONS_DIR = join(home, 'actions');
	process.env.POKEMON_LEARNING_DIR = join(home, 'learning');
	process.env.POKEMON_WEB_PROFILE = join(home, 'browser');
	process.env.POKEMON_USER_DATA_DIR = join(home, 'companion');
	process.env.POKEMON_CONNECTIONS_FILE = join(home, 'connections.json');
	const approvals = new GatewayApprovals();
	const tools = await harnessRuntime(approvals);
	if (mode === 'check') {
		const definitions = await tools.list();
		const status = await tools.call('desktop', {action: 'status'}, new AbortController().signal);
		console.log(JSON.stringify({runtime: 'pokemon-agent', tools: definitions.map((tool) => tool.name), desktop: status}, null, 2));
		await tools.close();
		await store.close();
		return;
	}

	const engine = new HarnessEngine(config, store, approvals, tools);
	const gateway = new TelegramGateway(
		engine,
		store.secret('TELEGRAM_BOT_TOKEN'),
		async () => {
			// Re-read so `pairing approve` from another terminal applies immediately.
			const current = await loadConfig(home, deepSeekOnly).catch(() => config);
			config.telegram = current.telegram;
			return {users: new Set(current.telegram.allowedUsers), groups: new Set(current.telegram.allowedGroups)};
		},
		async (userId, name) => requestPairing(home, userId, name),
	);
	const poll = gateway.run().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : 'Telegram startup failed.');
		process.exitCode = 1;
	});
	let closing = false;
	const close = async () => {
		if (closing) {
			return;
		}

		closing = true;
		gateway.stop();
		await poll;
		await engine.close();
		await tools.close();
		await store.close();
	};

	process.once('SIGINT', () => {
		void close();
	});
	process.once('SIGTERM', () => {
		void close();
	});
	await poll;
	await close();
}
