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
}).strict().refine((route) => {
	const url = new URL(route.baseUrl);
	return !url.username && !url.password && !url.search && !url.hash && (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)));
}, 'Use HTTPS or a local endpoint, with no credentials/query in its URL.');
export const configSchema = z.object({
	desktopRelay: z.object({enabled: z.boolean(), conversation: z.string().max(160), approval: z.enum(['per_message', 'scoped_grant']).default('per_message')}).strict().optional(),
	defaultRoute: z.string().max(100), routes: z.record(z.string().regex(/^[a-z0-9_-]{1,100}$/), routeSchema),
	fallbacks: z.array(z.string()).max(8).default([]), maxSteps: z.number().int().min(1).max(40).default(20),
	telegram: z.object({enabled: z.boolean().default(false), allowedUsers: z.array(z.string().regex(/^\d+$/)).max(20).default([]), allowedGroups: z.array(z.string().regex(/^-[1-9]\d*$/)).max(20).default([])}).strict(),
}).strict().refine((config) => Boolean(config.routes[config.defaultRoute]) && config.fallbacks.every((name) => Boolean(config.routes[name])), 'Default and fallback routes must exist.');
export type HarnessConfig = z.infer<typeof configSchema>;
export type Route = z.infer<typeof routeSchema>;
export const defaultConfig: HarnessConfig = {
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

export async function saveConfig(home: string, config: HarnessConfig) {
	const temporary = join(home, `config-${randomBytes(8).toString('hex')}.tmp`);
	await writeFile(temporary, JSON.stringify(config, null, 2), {flag: 'wx', mode: 0o600});
	await rename(temporary, join(home, 'config.json'));
}

export async function loadConfig(home: string): Promise<HarnessConfig> {
	await mkdir(home, {recursive: true, mode: 0o700});
	const file = join(home, 'config.json');
	try {
		return configSchema.parse(JSON.parse(await readFile(file, 'utf8')));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}

		await writeFile(file, JSON.stringify(defaultConfig, null, 2), {flag: 'wx', mode: 0o600});
		return structuredClone(defaultConfig);
	}
}
