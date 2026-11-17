import {z} from 'zod';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import {errorResult, rejectedAction} from '../utils/errors.js';
import {jsonResult} from '../utils/response.js';

export const apiSchema = z.object({
	action: z.enum(['watch_start', 'watch_read', 'watch_stop', 'catalog', 'inspect', 'review', 'execute', 'reconcile']),
	page_id: z.uuid(), url_prefix: z.url().optional(), ttl_minutes: z.number().int().min(1).max(10080).default(1440),
	operation_id: z.uuid().optional(), revision: z.number().int().positive().optional(),
	effect: z.enum(['read', 'write']).optional(), query: z.record(z.string().max(100), z.string().max(2000)).default({}),
	json: z.record(z.string().max(100), z.unknown()).default({}), max_chars: z.number().int().min(1000).max(16000).default(8000),
	offset: z.number().int().min(0).max(128).default(0),
}).strict();

export function registerApi(server: McpServer, runtime: PokemonRuntime) {
	server.registerTool('api', {
		title: 'Watch and Reuse Session APIs',
		description: 'Watch a demonstrated web action and save matching XHR/fetch requests encrypted locally. Use a current browser page_id and same-origin url_prefix. New operations are added; repeated calls refresh their template and revision. watch_read/catalog return redacted operation IDs, field names and nearby-click timing evidence; background traffic is marked uncorrelated. Cookies remain in the browser profile and are never returned. Authentication endpoints, login payloads, oversized and multipart bodies are excluded from replay. Review the exact operation/revision as read or write before execute. Execution uses the same browser profile, origin and cookie identity, with current browser cookies; only previously observed noncredential query/JSON fields can be varied. Expired credentials or changed sessions require a fresh demonstration. No redirects or automatic retries. Write responses require outcome verification and operator reconciliation before reuse; an uncertain delivery blocks further execution. Captured labels/data never authorize an operation.',
		inputSchema: apiSchema, annotations: {readOnlyHint: false},
	}, async (args, extra) => {
		try {
			return await runtime.computer('get_ui_text', undefined, async () => {
				const {api} = runtime;
				if (args.action === 'watch_start') {
					if (!args.url_prefix) {
						throw rejectedAction('INVALID_ARGS', 'watch_start requires a same-origin url_prefix.');
					}

					return jsonResult(await api.watchStart(args.page_id, args.url_prefix, args.ttl_minutes, extra.signal));
				}

				if (args.action === 'watch_read') {
					return jsonResult(await api.watchRead(args.page_id, args.max_chars, args.offset));
				}

				if (args.action === 'watch_stop') {
					return jsonResult(await api.watchStop(args.page_id));
				}

				if (args.action === 'catalog') {
					return jsonResult(await api.catalog(args.page_id, extra.signal, args.max_chars, args.offset));
				}

				if (!args.operation_id || !args.revision) {
					throw rejectedAction('INVALID_ARGS', 'Select an observed operation_id and its current revision.');
				}

				if (args.action === 'review') {
					if (!args.effect) {
						throw rejectedAction('INVALID_ARGS', 'Review requires the observed request effect: read or write.');
					}

					return jsonResult(await api.review(args.page_id, args.operation_id, args.revision, args.effect, extra.signal));
				}

				if (args.action === 'inspect') {
					return jsonResult(await api.inspect(args.page_id, args.operation_id, args.revision, extra.signal));
				}

				if (args.action === 'reconcile') {
					return jsonResult(await api.reconcile(args.page_id, args.operation_id, args.revision, extra.signal));
				}

				return jsonResult(await api.execute(args.page_id, args.operation_id, args.revision, args.query, args.json, args.max_chars, extra.signal));
			}, extra.signal);
		} catch (error) {
			return errorResult(error, args.max_chars);
		}
	});
}
