import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {performance} from 'node:perf_hooks';
import {z} from 'zod';
import {errorDetails} from '../utils/errors.js';
import type {LocalLearning} from './service.js';
import {mcpObjectSchema} from '../utils/mcp-schema.js';

type Handler = (args: Record<string, unknown>, extra: {signal: AbortSignal}) => Promise<CallToolResult>;
type Config = {[key: string]: unknown; inputSchema: z.ZodType};

/** Keep original validation/handlers; task attribution never alters native args. */
export function instrument(server: McpServer, learning: LocalLearning): McpServer {
	return new Proxy(server, {
		get(target, property) {
			if (property !== 'registerTool') {
				const value: unknown = Reflect.get(target, property, target);
				return typeof value === 'function' ? value.bind(target) as unknown : value;
			}

			return (name: string, config: Config, handler: Handler) => target.registerTool(name, {
				...config, inputSchema: mcpObjectSchema(config.inputSchema).safeExtend({task_id: z.uuid().optional().describe('Current learning task returned by learning begin. Enables local API/outcome records.')}).strict(),
			}, async (input, extra) => {
				if (!input || typeof input !== 'object' || Array.isArray(input)) {
					throw new Error('Tool input must be an object.');
				}

				// Restore branch-specific defaults/transforms only after the original union validates.
				const validated: unknown = config.inputSchema instanceof z.ZodDiscriminatedUnion ? config.inputSchema.parse(input) : input;
				const {task_id: taskId, ...args} = validated as Record<string, unknown>;
				if (!taskId) {
					return handler(args, extra);
				}

				if (typeof taskId !== 'string') {
					throw new Error('Invalid learning task id.');
				}

				await learning.enter(taskId);
				const start = performance.now();
				try {
					const result = await handler(args, extra);
					await learning.record(taskId, name, args, result, performance.now() - start);
					return result;
				} catch (error) {
					await learning.record(taskId, name, args, {isError: true, content: [{type: 'text', text: JSON.stringify({ok: false, error_details: errorDetails(error)})}]}, performance.now() - start);
					throw error;
				} finally {
					learning.leave(taskId);
				}
			});
		},
	});
}
