import {z} from 'zod';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import {errorResult} from '../utils/errors.js';

export function registerAssistant(server: McpServer, runtime: PokemonRuntime) {
	server.registerTool('assistant', {
		title: 'ChatGPT desktop relay',
		description: 'Inspect or send one exact question to an explicitly configured ChatGPT desktop conversation using the native UIA adapter. Waits for idle, verifies the draft and submission, then returns only a new completed answer. No API key is required. The conversation name must match the current document title from inspect. Never resends uncertain input. Keep the configured conversation open and the desktop unlocked.',
		inputSchema: z.object({
			action: z.enum(['inspect', 'ask']), conversation: z.string().max(160).optional(), question: z.string().min(1).max(8000).optional(), timeout_ms: z.number().int().min(1000).max(600000).default(600000),
		}).strict(),
		annotations: {readOnlyHint: false},
	}, async (args, extra) => {
		try {
			if (args.action === 'ask' && (!args.conversation || !args.question)) {
				throw new Error('ask requires an explicitly configured conversation and question.');
			}

			const result = args.action === 'inspect' ? await runtime.assistant.inspect(args.conversation, extra.signal) : await runtime.assistant.ask(args.conversation!, args.question!, extra.signal, args.timeout_ms);
			return {content: [{type: 'text' as const, text: JSON.stringify(result)}]};
		} catch (error) {
			return errorResult(error, 6000);
		}
	});
}
