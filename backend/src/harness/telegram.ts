/* eslint-disable no-await-in-loop -- Poll in order and deliver message chunks sequentially. */
import {type HarnessEngine} from './engine.js';
import {setTimeout as delay} from 'node:timers/promises';

type Update = {update_id: number; message?: {text?: string; from?: {id: number; is_bot?: boolean}; sender_chat?: {id: number}; reply_to_message?: {from?: {id: number; is_bot?: boolean}}; chat: {id: number; type: string}}};
export class TelegramGateway {
	connected = false;
	private readonly abort = new AbortController();
	private offset = 0;
	constructor(private readonly engine: HarnessEngine, private readonly token: string, private readonly allowed: Set<string>, private readonly endpoint = 'https://api.telegram.org', private readonly groups = new Set<string>()) {}
	async api(method: string, args: Record<string, unknown>) {
		const response = await fetch(`${this.endpoint}/bot${this.token}/${method}`, {
			method: 'POST', redirect: 'error', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(args), signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(40000)]),
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
		if (!message?.text || !message.from || message.from.is_bot || message.sender_chat || !this.allowed.has(String(message.from.id))) {
			return;
		}

		const senderId = message.from.id;

		const group = ['group', 'supergroup'].includes(message.chat.type);
		if (group ? !this.groups.has(String(message.chat.id)) : message.chat.type !== 'private') {
			return;
		}

		let text = message.text.trim();
		let mentioned = false;
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
			if (command ? !['task', 'pokemon', 'ask', 'api', 'status', 'model', 'new', 'stop', 'help', 'start'].includes(command[1] || '') : !mentioned && !replyToBot) {
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

		const principal = `telegram:${botId}:${message.from.id}:${message.chat.id}`;
		await this.engine.receive(principal, text, async (reply) => this.send(message.chat.id, reply), {
			principal: `telegram:${botId}:${message.from.id}`,
			send: async (reply) => {
				try {
					await this.send(senderId, reply);
				} catch {
					throw new Error('Open the bot privately and send /start before requesting group actions that need approval.');
				}
			},
		});
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
					await this.api('setMyCommands', {commands: [{command: 'ask', description: 'Ask the configured desktop chat'}, {command: 'task', description: 'Run a task on the home computer'}, {command: 'api', description: 'Use the configured provider API'}, {command: 'status', description: 'Check gateway status'}, {command: 'stop', description: 'Stop the current task'}, {command: 'model', description: 'Select a configured API route'}, {command: 'help', description: 'Show instructions'}]});
				}

				const updates = await this.api('getUpdates', {offset: this.offset, timeout: 25, allowed_updates: ['message']}) as Update[];
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
}
