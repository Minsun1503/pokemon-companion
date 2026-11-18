import type {HarnessConfig} from './config.js';
import type {HarnessStore} from './store.js';

async function readJson(response: Response) {
	if (!response.ok) {
		throw new Error(`Connection check returned HTTP ${response.status}.`);
	}

	const text = await response.text();
	if (text.length > 1000000) {
		throw new Error('Connection-check response is too large.');
	}

	return JSON.parse(text) as Record<string, unknown>;
}

/** Read-only model discovery. The saved key stays on this machine and is never returned. */
export async function checkModelConnection(config: HarnessConfig, store: HarnessStore, routeName: string, request: typeof fetch = fetch) {
	const route = config.routes[routeName];
	if (!route) {
		throw new Error('Choose a saved model route.');
	}

	const key = store.secret(route.keyEnv);
	if (!key) {
		throw new Error('Save an API key for this route first.');
	}

	const base = route.baseUrl.replace(/\/$/, '');
	const anthropic = route.transport === 'anthropic';
	const suffix = anthropic && !base.endsWith('/v1') ? '/v1/models' : '/models';
	const response = await request(base + suffix, {
		method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
		headers: anthropic ? {'x-api-key': key, 'anthropic-version': '2023-06-01'} : {Authorization: `Bearer ${key}`},
	});
	const data = await readJson(response);
	if (!Array.isArray(data.data)) {
		throw new Error('The endpoint did not return a model list.');
	}

	const models = data.data.flatMap((item: unknown) => {
		if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string' || !/^[\w./:-]{1,200}$/.test(item.id) || item.id.startsWith('sk-')) {
			return [];
		}

		return [item.id];
	}).slice(0, 100);
	return {
		connected: true, route: routeName, model: route.model, modelAvailable: models.includes(route.model), models,
	};
}

/** Never calls getUpdates: discovery must not compete with the running gateway's poller. */
export async function checkTelegramConnection(config: HarnessConfig, store: HarnessStore, request: typeof fetch = fetch, origin = 'https://api.telegram.org') {
	const key = store.secret('TELEGRAM_BOT_TOKEN');
	if (!key) {
		throw new Error('Save the Telegram bot token first.');
	}

	const read = async (method: string, body: Record<string, unknown> = {}) => {
		const response = await request(`${origin}/bot${key}/${method}`, {
			method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
		});
		const result = await readJson(response);
		if (result.ok !== true || !result.result || typeof result.result !== 'object') {
			throw new Error(`Telegram ${method} check failed.`);
		}

		return result.result as Record<string, unknown>;
	};

	const [bot, webhook] = await Promise.all([read('getMe'), read('getWebhookInfo')]);
	const groups = await Promise.all(config.telegram.allowedGroups.map(async (id) => {
		const group = await read('getChat', {chat_id: id});
		return {id, title: typeof group.title === 'string' ? group.title.slice(0, 200) : '', type: group.type};
	}));
	return {
		connected: true, botUsername: bot.username, displayName: bot.first_name, canReadAllGroupMessages: bot.can_read_all_group_messages === true, webhookConfigured: Boolean(webhook.url), groups, allowedUsers: config.telegram.allowedUsers.length,
	};
}

/** Changes the display name only; Telegram's globally unique @username is unchanged. */
export async function setTelegramDisplayName(store: HarnessStore, name: string, request: typeof fetch = fetch, origin = 'https://api.telegram.org') {
	const key = store.secret('TELEGRAM_BOT_TOKEN');
	if (!key || !name.trim() || name.length > 64) {
		throw new Error('Save a bot token and choose a name of 1–64 characters.');
	}

	const invoke = async (method: string, body: Record<string, unknown>) => readJson(await request(`${origin}/bot${key}/${method}`, {
		method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
	}));
	const saved = await invoke('setMyName', {name: name.trim()});
	if (saved.ok !== true || saved.result !== true) {
		throw new Error('Telegram did not confirm the name change.');
	}

	const verified = await invoke('getMyName', {});
	if (verified.ok !== true || (verified.result as {name?: unknown} | undefined)?.name !== name.trim()) {
		throw new Error('Name change could not be verified. Check Telegram before retrying.');
	}

	return {saved: true, displayName: name.trim()};
}
