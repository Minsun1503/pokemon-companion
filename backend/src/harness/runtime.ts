import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {createServer} from '../index.js';
import {PokemonRuntime} from '../pokemon/runtime.js';
import {DesktopCompanion} from '../pokemon/companion.js';
import type {ApprovalIntent} from '../security/approval.js';
import {type GatewayApprovals} from './approvals.js';

class TelegramCompanion extends DesktopCompanion {
	constructor(private readonly remote: GatewayApprovals) {
		super();
	}

	override async approve(intent: ApprovalIntent) {
		if (this.remote.context.getStore()) {
			return this.remote.ask(intent);
		}

		return super.approve(intent);
	}

	override async revokeScope(scope: string) {
		this.remote.revokeScope();
		await super.revokeScope(scope);
	}
}
export async function harnessRuntime(approvals: GatewayApprovals) {
	// The harness owns its runtime; inherited development overrides must not bypass approval.
	for (const key of ['POKEMON_BROWSER_ORIGINS', 'POKEMON_LAUNCH_ALLOWLIST']) {
		Reflect.deleteProperty(process.env, key);
	}

	for (const key of ['POKEMON_AUTHORIZATION', 'POKEMON_BROWSER_INPUT', 'POKEMON_BROWSER_ATTACH', 'POKEMON_API_EXECUTION']) {
		process.env[key] = 'companion';
	}

	const runtime = new PokemonRuntime(new TelegramCompanion(approvals));
	const server = createServer(runtime);
	const client = new Client({name: 'pokemon-agent', version: '0.1.0'});
	const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	await runtime.companion.start();
	return {
		list: async () => (await client.listTools()).tools.filter((tool) => tool.name !== 'learning'),
		call: async (name: string, args: Record<string, unknown>, signal: AbortSignal) => CallToolResultSchema.parse(await client.callTool({name, arguments: name === 'browser' && args.action === 'launch' ? {...args, profile: args.profile ?? process.env.POKEMON_WEB_PROFILE} : args}, undefined, {signal, timeout: name === 'assistant' ? 1300000 : 360000})),
		async close() {
			await client.close();
			await server.close();
			await runtime.close();
		},
	};
}
