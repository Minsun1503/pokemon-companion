/* eslint-disable no-await-in-loop -- Poll in order and deliver message chunks sequentially. */
import {type HarnessEngine} from './engine.js';
import {setTimeout as delay} from 'node:timers/promises';

type Callback = {id: string; data?: string; from: {id: number; is_bot?: boolean}; message?: {message_id: number; from?: {id: number; is_bot?: boolean}; chat: {id: number; type: string}}};
type Update = {update_id: number; callback_query?: Callback; message?: {text?: string; entities?: {type: string; offset: number; length: number; user?: {id: number; is_bot?: boolean}}[]; from?: {id: number; is_bot?: boolean}; sender_chat?: {id: number}; reply_to_message?: {from?: {id: number; is_bot?: boolean}}; chat: {id: number; type: string}}};
export class TelegramGateway {
	connected = false;
	private readonly abort = new AbortController();
	private offset = 0;
	private readonly approvalButtons = new Map<string, {chat: number; message: number; owner: number; bot: string; principal: string}>();
	constructor(private readonly engine: HarnessEngine, private readonly token: string, private readonly allowed: Set<string>, private readonly endpoint = 'https://api.telegram.org', private readonly groups = new Set<string>()) {}
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
		if (update.callback_query) {
			await this.handleApproval(update, botId);
			return;
		}

		const {message} = update;
		if (!message?.text || !message.from || message.from.is_bot || message.sender_chat || !this.allowed.has(String(message.from.id))) {
			return;
		}

		const senderId = message.from.id;

		const group = ['group', 'supergroup'].includes(message.chat.type);
		const location = /^\/whereami(?:@(\w+))?\s*$/i.exec(message.text.trim());
		if (location && (group ? location[1]?.toLowerCase() === botUsername.toLowerCase() : (!location[1] || location[1].toLowerCase() === botUsername.toLowerCase()))) {
			if (await this.engine.store.admitTelegram(botId, update.update_id)) {
				await this.send(senderId, `Your Telegram user ID: ${senderId}\n${group ? 'Group' : 'Private chat'} ID: ${message.chat.id}\nEnter the group ID in this computer's local Pokémon setup. This command does not authorize the group or control the computer.`);
			}

			return;
		}

		if (group ? !this.groups.has(String(message.chat.id)) : message.chat.type !== 'private') {
			return;
		}

		let {text} = message;
		let mentioned = false;
		if (group) {
			// Telegram entity offsets use UTF-16, matching JavaScript string slicing.
			// Only a real mention of this bot's numeric identity authorizes name-based routing.
			const mentions = (message.entities ?? []).filter((entity) => entity.type === 'text_mention' && entity.user?.is_bot === true && String(entity.user.id) === botId
				&& Number.isSafeInteger(entity.offset) && Number.isSafeInteger(entity.length) && entity.offset >= 0 && entity.length > 0 && entity.offset + entity.length <= text.length).sort((a, b) => b.offset - a.offset);
			for (const entity of mentions) {
				text = text.slice(0, entity.offset) + text.slice(entity.offset + entity.length);
				mentioned = true;
			}
		}

		text = text.trim();
		if (group && botUsername) {
			text = text.replace(/(^|[^\w@])@(\w+)\b/g, (match: string, prefix: string, username: string) => {
				if (username.toLowerCase() !== botUsername.toLowerCase()) {
					return match;
				}

				mentioned = true;
				return prefix;
			}).trim();
			if (mentioned && !text) {
				text = '/help';
			}
		}

		const command = /^\/(\w+)(?:@([\w]+))?(?:\s+([\s\S]*))?$/.exec(text);
		if (command?.[2] && command[2].toLowerCase() !== botUsername.toLowerCase()) {
			return;
		}

		if (group) {
			const replyToBot = message.reply_to_message?.from?.is_bot && String(message.reply_to_message.from.id) === botId;
			if (command ? !['session', 'register', 'task', 'pokemon', 'ask', 'api', 'team', 'tasks', 'taskstatus', 'budget', 'remember', 'memory', 'forgetmemory', 'status', 'model', 'new', 'stop', 'help', 'start'].includes(command[1] || '') : !mentioned && !replyToBot) {
				return;
			}
		}

		if (command) {
			text = ['task', 'pokemon'].includes(command[1] || '') ? command[3] || '' : `/${command[1]}${command[3] ? ` ${command[3]}` : ''}`;
		}

		if (!await this.engine.store.admitTelegram(botId, update.update_id)) {
			return;
		}

		if (this.abort.signal.aborted) {
			return;
		}

		if (group) {
			const previous = this.engine.store.registration(botId, String(senderId));
			await this.engine.store.register(botId, String(senderId), String(message.chat.id));
			let delivered = Boolean(previous?.group === String(message.chat.id));
			if (!delivered) {
				try {
					await this.send(senderId, 'Phiên riêng của bạn đã sẵn sàng. Cứ nhắn việc cần làm ở đây; mình sẽ trả lời và xin duyệt ngay trong cuộc trò chuyện này.');
					delivered = true;
				} catch {/* Telegram requires the person to start the private chat first. */}
			}

			await this.send(message.chat.id, `${delivered ? 'Phiên riêng đã sẵn sàng. Nhắn việc với mình tại' : 'Đã đăng ký phiên. Mở liên kết và bấm Bắt đầu để nhắn riêng với mình:'}\nhttps://t.me/${botUsername}?start=session`);
			return;
		}

		if (message.chat.id !== senderId) {
			return;
		}

		const registration = this.engine.store.registration(botId, String(senderId));
		if (!registration || !this.groups.has(registration.group)) {
			await this.send(senderId, 'Bạn hãy gọi mình trong nhóm đăng ký đã được chủ máy cho phép để tạo phiên riêng trước nhé.');
			return;
		}

		if (['start', 'help'].includes(command?.[1] ?? '') || /^(hi|hello|xin chào|chào)[!.?\s]*$/i.test(text)) {
			await this.send(senderId, 'Mình sẵn sàng. Bạn cứ nhắn việc cần làm ở đây, không cần @ hay gõ lệnh. Khi cần thao tác có duyệt, mình sẽ hiện nút ngay tại đây. Bạn có thể nói “dừng lại” hoặc “bắt đầu phiên mới”.');
			return;
		}

		if (/^(dừng lại|dừng|stop)[.!\s]*$/i.test(text)) {
			text = '/stop';
		} else if (/^(bắt đầu phiên mới|tạo phiên mới|cuộc trò chuyện mới)[.!\s]*$/i.test(text)) {
			text = '/new';
		}

		const principal = `telegram:${botId}:${senderId}:session:${registration.session}`;
		const approvalPrincipal = principal;
		if (['allow', 'deny'].includes(command?.[1] ?? '')) {
			await this.send(senderId, 'Bạn dùng nút Cho phép hoặc Từ chối trên yêu cầu duyệt nhé.');
			return;
		}

		if (text === '/stop') {
			this.engine.stop(principal);
			await this.send(senderId, 'Đã yêu cầu dừng. Mình sẽ không tự gửi lại thao tác đã chạy.');
			return;
		}

		const typing = async () => this.api('sendChatAction', {chat_id: senderId, action: 'typing'}, 5000).catch(() => undefined);
		void typing();
		const timer = setInterval(() => {
			void typing();
		}, 4000);
		timer.unref();
		try {
			await this.engine.receive(principal, text, async (reply) => this.send(senderId, reply), {
				principal: approvalPrincipal, conversational: true,
				send: async (reply) => this.send(senderId, reply),
				sendApproval: async (prompt, code) => this.sendApproval(senderId, senderId, botId, approvalPrincipal, prompt, code),
			});
		} finally {
			clearInterval(timer);
		}
	}

	async run() {
		if (!this.token || !this.allowed.size) {
			throw new Error('Configure a Telegram bot token and specific allowed user IDs before starting.');
		}

		let bot: {id: number; username?: string} | undefined;
		while (!this.abort.signal.aborted) {
			try {
				if (!bot) {
					bot = await this.api('getMe', {}) as {id: number; username?: string};
					const previous = this.engine.store.telegramOffset(String(bot.id));
					if (previous !== undefined) {
						this.offset = previous + 1;
					}

					console.log(`Telegram connected: @${bot.username || 'bot'}. Allowed private chats and ${this.groups.size} designated groups enabled.`);
					await this.api('setMyCommands', {commands: [{command: 'start', description: 'Bắt đầu nhắn riêng'}, {command: 'new', description: 'Bắt đầu phiên mới'}, {command: 'stop', description: 'Dừng việc đang làm'}]});
				}

				const updates = await this.api('getUpdates', {offset: this.offset, timeout: 25, allowed_updates: ['message', 'callback_query']}) as Update[];
				this.connected = true;
				// Do not await running turns here: their /allow or /stop commands must still be received.
				for (const update of updates) {
					void this.handle(update, String(bot.id), bot.username).catch(() => {
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

	private async sendApproval(chat: number, owner: number, bot: string, principal: string, text: string, code: string) {
		const prompt = `Chỉ người giao việc (ID ${owner}) được duyệt.\n${text}`;
		const chunks = Array.from({length: Math.ceil(prompt.length / 3500)}, (_value, index) => prompt.slice(index * 3500, (index + 1) * 3500));
		for (const chunk of chunks.slice(0, -1)) {
			await this.send(chat, chunk);
		}

		const result = await this.api('sendMessage', {chat_id: chat, text: chunks.at(-1), reply_markup: {inline_keyboard: [[{text: 'Cho phép', callback_data: `pk:a:${code}`}, {text: 'Từ chối', callback_data: `pk:d:${code}`}]]}});
		if (!result || typeof result !== 'object' || !('message_id' in result) || !Number.isSafeInteger(result.message_id)) {
			throw new Error('Approval message delivery could not be verified. No action was approved.');
		}

		const message = result.message_id as number;
		this.approvalButtons.set(code, {
			chat, message, owner, bot, principal,
		});
		return async () => {
			this.approvalButtons.delete(code);
			await this.api('editMessageReplyMarkup', {chat_id: chat, message_id: message, reply_markup: {inline_keyboard: []}}, 5000).catch(() => undefined);
		};
	}

	private async handleApproval(update: Update, botId: string) {
		const callback = update.callback_query!;
		const match = /^pk:([ad]):([a-f0-9]{32})$/.exec(callback.data ?? '');
		const pending = match ? this.approvalButtons.get(match[2]!) : undefined;
		const {message} = callback;
		const registration = this.engine.store.registration(botId, String(callback.from.id));
		const permittedChat = message && registration && this.groups.has(registration.group) && message.chat.type === 'private' && message.chat.id === callback.from.id;
		let accepted = false;
		if (pending && match && message && permittedChat && this.allowed.has(String(callback.from.id)) && !callback.from.is_bot
			&& pending.principal === `telegram:${botId}:${callback.from.id}:session:${registration.session}`
			&& pending.owner === callback.from.id && pending.chat === message.chat.id && pending.message === message.message_id
			&& pending.bot === botId && message.from?.is_bot === true && String(message.from.id) === botId
			&& await this.engine.store.admitTelegram(botId, update.update_id)) {
			accepted = this.engine.approvals.decide(pending.principal, match[2]!, match[1] === 'a');
		}

		await this.api('answerCallbackQuery', {callback_query_id: callback.id, text: accepted ? (match?.[1] === 'a' ? 'Đã cho phép.' : 'Đã từ chối.') : 'Chỉ người giao việc được duyệt. Yêu cầu có thể đã hết hạn hoặc được xử lý.'}, 5000).catch(() => undefined);
	}
}
