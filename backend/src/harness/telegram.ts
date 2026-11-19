/* eslint-disable no-await-in-loop -- Poll in order and deliver message chunks sequentially. */
import {type HarnessEngine} from './engine.js';
import {setTimeout as delay} from 'node:timers/promises';

type User = {id: number; is_bot?: boolean; first_name?: string; username?: string};
type Message = {
	text?: string; from?: User; sender_chat?: {id: number}; chat: {id: number; type: string};
	entities?: {type: string; offset: number; length: number; user?: User}[];
	reply_to_message?: {from?: User};
};
type Update = {update_id: number; message?: Message};
/** Current access lists; re-read per message so `pairing approve` takes effect without a restart. */
export type TelegramAccess = () => Promise<{users: Set<string>; groups: Set<string>}>;
/** Issues a pairing code for an unknown private sender; undefined when too many codes are pending. */
export type PairingIssuer = (userId: string, name: string) => Promise<{code: string; created: boolean} | undefined>;

/**
 * Hermes-style Telegram gateway. Private chats are the primary surface; unknown
 * senders get a pairing code the owner approves locally. Groups are optional and
 * only answer allowlisted users who mention or reply to the bot.
 */
export class TelegramGateway {
	connected = false;
	bot: {id: number; username?: string} | undefined;
	private readonly abort = new AbortController();
	private offset = 0;
	constructor(
		private readonly engine: HarnessEngine,
		private readonly token: string,
		private readonly access: TelegramAccess,
		private readonly pairing: PairingIssuer,
		private readonly endpoint = 'https://api.telegram.org',
	) {}

	async api(method: string, args: Record<string, unknown>, timeout = 40000) {
		const response = await fetch(`${this.endpoint}/bot${this.token}/${method}`, {
			method: 'POST', redirect: 'error', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(args), signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(timeout)]),
		});
		if (!response.ok) {
			throw new Error(`Telegram ${method} HTTP ${response.status}`);
		}

		const data = await response.json() as {ok: boolean; result: unknown};
		if (!data.ok) {
			throw new Error(`Telegram ${method} failed.`);
		}

		return data.result;
	}

	async send(chat: number, text: string) {
		for (let offset = 0; offset < text.length; offset += 3500) {
			await this.api('sendMessage', {chat_id: chat, text: text.slice(offset, offset + 3500)});
		}
	}

	async handle(update: Update, botId: string, botUsername = '') {
		if (this.abort.signal.aborted) {
			return;
		}

		this.offset = Math.max(this.offset, update.update_id + 1);
		const {message} = update;
		if (!message?.text || !message.from || message.from.is_bot || message.sender_chat) {
			return;
		}

		const sender = String(message.from.id);
		const group = ['group', 'supergroup'].includes(message.chat.type);
		if (!group && message.chat.type !== 'private') {
			return;
		}

		let text = message.text.trim();
		if (group) {
			const addressed = this.addressedText(message, botId, botUsername);
			if (addressed === undefined) {
				return;
			}

			text = addressed;
		} else {
			const command = /^\/(\w+)@(\w+)/.exec(text);
			if (command?.[2] && command[2].toLowerCase() !== botUsername.toLowerCase()) {
				return;
			}

			text = text.replace(/^(\/\w+)@\w+/, '$1');
		}

		const {users, groups} = await this.access();
		if (!users.has(sender)) {
			if (group || !await this.engine.store.admitTelegram(botId, update.update_id)) {
				return; // Strangers never trigger work; pairing happens in private only.
			}

			const pairing = await this.pairing(sender, [message.from.first_name, message.from.username && `@${message.from.username}`].filter(Boolean).join(' '));
			await this.send(message.chat.id, pairing
				? `Mình chưa được ghép cặp với bạn.\nMã ghép cặp: ${pairing.code}\n\nChủ máy chạy lệnh này trên máy tính để cho phép (mã hết hạn sau 1 giờ):\nnpm run agent -- pairing approve ${pairing.code}`
				: 'Đang có quá nhiều yêu cầu ghép cặp chờ duyệt. Thử lại sau nhé.');
			return;
		}

		if (group && !groups.has(String(message.chat.id))) {
			return;
		}

		if (!await this.engine.store.admitTelegram(botId, update.update_id) || this.abort.signal.aborted) {
			return;
		}

		if (/^(dừng lại|dừng|stop)[.!\s]*$/i.test(text)) {
			text = '/stop';
		} else if (/^(bắt đầu phiên mới|tạo phiên mới|cuộc trò chuyện mới)[.!\s]*$/i.test(text)) {
			text = '/new';
		} else if (/^\/(?:task|pokemon)(?:\s|$)/.test(text)) {
			text = text.replace(/^\/\w+\s*/, '');
		}

		const chat = message.chat.id;
		const principal = group ? `telegram:${botId}:${sender}:${chat}` : `telegram:${botId}:${sender}`;
		if (text === '/stop') {
			this.engine.stop(principal);
			await this.send(chat, 'Đã dừng. Mình sẽ không tự chạy lại thao tác đã gửi.');
			return;
		}

		const typing = async () => this.api('sendChatAction', {chat_id: chat, action: 'typing'}, 5000).catch(() => undefined);
		void typing();
		const timer = setInterval(() => {
			void typing();
		}, 4000);
		timer.unref();
		try {
			const reply = async (value: string) => this.send(chat, value);
			await this.engine.receive(principal, text || '/help', reply, {principal, conversational: true, send: reply});
		} finally {
			clearInterval(timer);
		}
	}

	async run() {
		if (!this.token) {
			throw new Error('Chưa có Telegram bot token. Chạy: npm run agent -- setup');
		}

		while (!this.abort.signal.aborted) {
			try {
				if (!this.bot) {
					this.bot = await this.api('getMe', {}) as {id: number; username?: string};
					const previous = this.engine.store.telegramOffset(String(this.bot.id));
					if (previous !== undefined) {
						this.offset = previous + 1;
					}

					console.log(`Telegram connected: @${this.bot.username || 'bot'}. Nhắn riêng cho bot để bắt đầu.`);
					await this.api('setMyCommands', {commands: [{command: 'new', description: 'Bắt đầu phiên mới'}, {command: 'stop', description: 'Dừng việc đang làm'}, {command: 'status', description: 'Trạng thái'}, {command: 'help', description: 'Hướng dẫn'}]}).catch(() => undefined);
				}

				const updates = await this.api('getUpdates', {offset: this.offset, timeout: 25, allowed_updates: ['message']}) as Update[];
				this.connected = true;
				// Do not await running turns here: /stop must still be received.
				for (const update of updates) {
					void this.handle(update, String(this.bot.id), this.bot.username).catch(() => {
						console.error('Telegram turn failed; no automatic replay was sent.');
					});
				}
			} catch {
				this.connected = false;
				if (this.abort.signal.aborted) {
					break;
				}

				console.error('Telegram connection interrupted; polling will reconnect.');
				await delay(3000, undefined, {signal: this.abort.signal}).catch(() => undefined);
			}
		}
	}

	stop() {
		this.connected = false;
		this.abort.abort();
	}

	/** Group text addressed to this bot, with the mention removed; undefined when not addressed. */
	private addressedText(message: Message, botId: string, botUsername: string) {
		let text = message.text ?? '';
		let addressed = Boolean(message.reply_to_message?.from?.is_bot && String(message.reply_to_message.from.id) === botId);
		// Telegram entity offsets use UTF-16, matching JavaScript string slicing.
		const mentions = (message.entities ?? []).filter((entity) => entity.type === 'text_mention' && entity.user?.is_bot === true && String(entity.user.id) === botId
			&& entity.offset >= 0 && entity.length > 0 && entity.offset + entity.length <= text.length).sort((a, b) => b.offset - a.offset);
		for (const entity of mentions) {
			text = text.slice(0, entity.offset) + text.slice(entity.offset + entity.length);
			addressed = true;
		}

		if (botUsername) {
			text = text.replace(/(^|[^\w@])@(\w+)\b/g, (match: string, prefix: string, username: string) => {
				if (username.toLowerCase() !== botUsername.toLowerCase()) {
					return match;
				}

				addressed = true;
				return prefix;
			});
			const command = /^\s*\/(\w+)@(\w+)/.exec(text);
			if (command) {
				if (command[2]!.toLowerCase() !== botUsername.toLowerCase()) {
					return undefined;
				}

				text = text.replace(/^\s*(\/\w+)@\w+/, '$1');
				addressed = true;
			}
		}

		return addressed ? text.trim() : undefined;
	}
}
