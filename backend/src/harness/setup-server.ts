import express from 'express';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {configSchema, saveConfig, type HarnessConfig} from './config.js';
import type {HarnessStore} from './store.js';
import {setupPage} from './setup-page.js';

export function setupApp(options: {
	home: string; config: HarnessConfig; store: HarnessStore;
	busy: () => boolean; telegramStatus: () => string; changed: () => Promise<void>;
	setConfiguring?: (value: boolean) => void;
	inspectDesktop?: (current: boolean) => Promise<unknown>;
}, token = randomBytes(32).toString('hex')) {
	const {home, config, store} = options;
	const app = express();
	app.use((_request, response, next) => {
		response.setHeader('Cache-Control', 'no-store');
		response.setHeader('Referrer-Policy', 'no-referrer');
		response.setHeader('X-Content-Type-Options', 'nosniff');
		response.setHeader('Content-Security-Policy', 'default-src \'self\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'self\'; frame-ancestors \'none\'; base-uri \'none\'; form-action \'none\'');
		next();
	});
	app.get('/', (_request, response) => {
		response.type('html').send(setupPage);
	});
	app.use('/api', (request, response, next) => {
		const supplied = Buffer.from(request.headers.authorization || '');
		const expected = Buffer.from(`Bearer ${token}`);
		if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
			response.status(401).json({error: 'Local setup authorization required.'});
			return;
		}

		next();
	});
	app.use(express.json({limit: '64kb'}));
	app.get('/api/status', (_request, response) => response.json({
		config, keys: Object.fromEntries(Object.values(config.routes).map((route) => [route.keyEnv, Boolean(store.secret(route.keyEnv))])),
		telegram: options.telegramStatus(), botTokenConfigured: Boolean(store.secret('TELEGRAM_BOT_TOKEN')),
	}));
	app.get('/api/desktop-relay', async (request, response) => {
		try {
			response.json(await options.inspectDesktop?.(request.query.current === '1') ?? {ready: false, error: 'Desktop relay is unavailable.'});
		} catch {
			response.status(503).json({ready: false, error: 'Desktop relay inspection failed.'});
		}
	});
	const schema = z.object({config: configSchema, secrets: z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), z.string().min(1).max(8000)).default({})}).strict();
	let configuring: Promise<unknown> = Promise.resolve();
	app.post('/api/config', async (request, response) => {
		const job = configuring.catch(() => undefined).then(async () => {
			if (options.busy()) {
				throw new Error('Stop the current task before changing its model or Telegram credentials.');
			}

			const next = schema.parse(request.body);
			if (next.config.telegram.enabled && (!next.config.telegram.allowedUsers.length || !(next.secrets.TELEGRAM_BOT_TOKEN || store.secret('TELEGRAM_BOT_TOKEN')))) {
				throw new Error('Enter the bot token and allowed Telegram user IDs.');
			}

			options.setConfiguring?.(true);
			try {
				await store.putSecrets(next.secrets);
				await saveConfig(home, next.config);
				Object.assign(config, next.config);
				await options.changed();
			} finally {
				options.setConfiguring?.(false);
			}
		});
		configuring = job;
		try {
			await job;
			response.json({saved: true});
		} catch {
			response.status(400).json({error: options.busy() ? 'Use /stop before changing settings for a running task.' : 'Settings could not be saved. Check the route name, HTTPS URL, model, credential name, and Telegram user IDs.'});
		}
	});
	return {
		app, token, async settled() {
			await configuring.catch(() => undefined);
		},
	};
}
