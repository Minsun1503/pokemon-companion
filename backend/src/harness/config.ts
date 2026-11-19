import {z} from 'zod';
import {
	mkdir, readFile, writeFile, rename,
} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {homedir} from 'node:os';

export const routeSchema = z.object({
	label: z.string().min(1).max(100), transport: z.enum(['openai', 'anthropic']), baseUrl: z.url(),
	model: z.string().max(200), keyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
	pricing: z.object({input: z.number().nonnegative(), output: z.number().nonnegative()}).strict().optional(),
	outputTokenParameter: z.enum(['max_tokens', 'max_completion_tokens']).optional(),
}).strict().refine((route) => {
	const url = new URL(route.baseUrl);
	return !url.username && !url.password && !url.search && !url.hash && (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)));
}, 'Use HTTPS or a local endpoint, with no credentials/query in its URL.');
export const teamSchema = z.object({
	enabled: z.boolean().default(true), auto: z.boolean().default(false),
	maxConcurrent: z.number().int().min(1).max(4).default(2),
	maxDelegations: z.number().int().min(1).max(12).default(6),
	maxModelCalls: z.number().int().min(1).max(80).default(24),
	maxTokens: z.number().int().min(1024).max(1000000).default(100000),
	maxOutputTokens: z.number().int().min(128).max(8192).default(2048),
	maxCostUsd: z.number().min(0).max(100).default(0),
	routes: z.object({
		researcher: z.string().optional(), writer: z.string().optional(), analyst: z.string().optional(), reviewer: z.string().optional(),
	}).strict().default({}),
}).strict();
export const defaultTeam = teamSchema.parse({});
export const configSchema = z.object({
	team: teamSchema.optional(),
	defaultRoute: z.string().max(100), routes: z.record(z.string().regex(/^[a-z0-9_-]{1,100}$/), routeSchema),
	fallbacks: z.array(z.string()).max(8).default([]), maxSteps: z.number().int().min(1).max(40).default(20),
	telegram: z.object({enabled: z.boolean().default(false), allowedUsers: z.array(z.string().regex(/^\d+$/)).max(20).default([]), allowedGroups: z.array(z.string().regex(/^-[1-9]\d*$/)).max(20).default([])}).strict(),
}).strict().refine((config) => Boolean(config.routes[config.defaultRoute]) && [...config.fallbacks, ...Object.values(config.team?.routes ?? {})].every((name) => !name || Boolean(config.routes[name])), 'Default, specialist and fallback routes must exist.');
export type HarnessConfig = z.infer<typeof configSchema>;
export type Route = z.infer<typeof routeSchema>;
export const defaultConfig: HarnessConfig = {
	team: structuredClone(defaultTeam),
	defaultRoute: 'deepseek', fallbacks: [], maxSteps: 20,
	routes: {
		deepseek: {
			label: 'DeepSeek API', transport: 'openai', baseUrl: 'https://api.deepseek.com', model: '', keyEnv: 'DEEPSEEK_API_KEY',
		},
		claude: {
			label: 'Claude API', transport: 'anthropic', baseUrl: 'https://api.anthropic.com', model: '', keyEnv: 'ANTHROPIC_API_KEY',
		},
		openai: {
			label: 'OpenAI API', transport: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', keyEnv: 'OPENAI_API_KEY',
		},
	},
	telegram: {enabled: false, allowedUsers: [], allowedGroups: []},
};
export function harnessHome() {
	return process.env.POKEMON_HARNESS_HOME || join(process.env.LOCALAPPDATA || homedir(), 'pokemon-companion', 'harness');
}

export function deepSeekConfig(): HarnessConfig {
	return {
		...structuredClone(defaultConfig),
		team: {...structuredClone(defaultTeam), auto: true, routes: {}},
		routes: {deepseek: {...defaultConfig.routes.deepseek!, model: 'deepseek-flash'}},
	};
}

export function validateDeepSeekConfig(config: HarnessConfig, secrets: Record<string, string> = {}) {
	const route = config.routes.deepseek;
	if (Object.keys(config.routes).length !== 1 || !route || config.defaultRoute !== 'deepseek'
		|| route.baseUrl !== 'https://api.deepseek.com' || route.transport !== 'openai' || route.keyEnv !== 'DEEPSEEK_API_KEY'
		|| config.fallbacks.length
		|| Object.values(config.team?.routes ?? {}).some((name) => name && name !== 'deepseek')
		|| Object.keys(secrets).some((name) => !['DEEPSEEK_API_KEY', 'TELEGRAM_BOT_TOKEN'].includes(name))) {
		throw new Error('This Telegram package uses one DeepSeek API route and credential only.');
	}
}

export async function saveConfig(home: string, config: HarnessConfig) {
	const temporary = join(home, `config-${randomBytes(8).toString('hex')}.tmp`);
	await writeFile(temporary, JSON.stringify(config, null, 2), {flag: 'wx', mode: 0o600});
	await rename(temporary, join(home, 'config.json'));
}

export async function loadConfig(home: string, deepSeekOnly = false): Promise<HarnessConfig> {
	await mkdir(home, {recursive: true, mode: 0o700});
	const file = join(home, 'config.json');
	try {
		const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
		Reflect.deleteProperty(raw, 'desktopRelay'); // Removed with the web setup; older files stay loadable.
		const config = configSchema.parse(raw);
		if (deepSeekOnly) {
			validateDeepSeekConfig(config);
		}

		return config;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}

		const config = deepSeekOnly ? deepSeekConfig() : structuredClone(defaultConfig);
		await writeFile(file, JSON.stringify(config, null, 2), {flag: 'wx', mode: 0o600});
		return config;
	}
}
