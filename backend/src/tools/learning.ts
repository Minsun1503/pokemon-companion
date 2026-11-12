import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {performance} from 'node:perf_hooks';
import {z} from 'zod';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import {parametersSchema} from '../learning/service.js';
import {runWindowsBatch} from '../windows/batch.js';
import {jsonResult} from '../utils/response.js';
import {errorDetails} from '../utils/errors.js';
import {timedCall} from '../utils/timing.js';
import {traceClientCall} from '../utils/client-timing.js';

export function registerLearning(server: McpServer, runtime: PokemonRuntime): void {
	server.registerTool('learning', {
		title: 'Local Workflow Learning',
		description: 'Local encrypted task records and a tiny CPU-only online workflow model. begin takes the verbatim current user query and named current parameters; copy task_id into subsequent tools. suggest retrieves reliable workflows. preview binds current parameters and returns a concrete plan; run consumes that single-use preview, executes original Windows guards with fresh discovery and no input retries. Review plan against current user intent before run. finish reports observed outcome separately from user satisfaction. feedback requires an explicit user report; never infer satisfaction from success. The companion also offers genuine user feedback buttons. configure controls collection/retention; forget erases records/model; export returns a record page. No screenshots, full app contents, cloud training or generated-code execution.',
		inputSchema: z.object({
			action: z.enum(['begin', 'suggest', 'preview', 'run', 'use_guide', 'finish', 'feedback', 'status', 'configure', 'forget', 'export']),
			query: z.string().min(1).max(4096).refine((value) => value.trim().length > 0).optional(),
			parameters: parametersSchema.optional(),
			task_id: z.uuid().optional(),
			recipe_id: z.string().regex(/^[a-f0-9]{32}$/).optional(),
			preview_id: z.uuid().optional(),
			outcome: z.enum(['met', 'unmet', 'unknown']).optional(),
			summary: z.string().max(1000).optional(),
			satisfaction: z.enum(['satisfied', 'unsatisfied', 'unknown']).optional(),
			enabled: z.boolean().optional(),
			retention_days: z.number().int().min(1).max(365).optional(),
			offset: z.number().int().min(0).max(2 * 1024 * 1024).default(0),
			max_chars: z.number().int().min(1000).max(16000).default(8000),
			version: z.string().regex(/^[a-f0-9]{64}$/).optional(),
		}).strict(),
		annotations: {readOnlyHint: false},
	}, async (args, extra) => timedCall('learning', args.action, async () => traceClientCall(args.action === 'begin' ? undefined : args.task_id, 'learning', args.action, async () => {
		const required = <T>(value: T | undefined, name: string): T => {
			if (value === undefined) {
				throw new Error(`${args.action} requires ${name}.`);
			}

			return value;
		};

		const {learning} = runtime;
		switch (args.action) {
			case 'begin': {
				const task = await learning.begin(required(args.query, 'query'), args.parameters ?? {});
				return traceClientCall(task.id, 'learning', 'begin', async () => {
					await runtime.update({learningTaskId: task.id, learningFeedbackPending: false});
					return jsonResult({task_id: task.id, suggestions: await learning.suggest(task.query)});
				});
			}

			case 'suggest':
				return jsonResult({suggestions: await learning.suggest(required(args.query, 'query'))});
			case 'preview':
				return jsonResult(await learning.preview(required(args.task_id, 'task_id'), required(args.recipe_id, 'recipe_id'), args.parameters ?? {}));
			case 'use_guide':
				return jsonResult(await learning.useGuide(required(args.task_id, 'task_id'), required(args.recipe_id, 'recipe_id')));
			case 'run': {
				const taskId = required(args.task_id, 'task_id');
				const steps = await learning.consume(taskId, required(args.preview_id, 'preview_id'));
				const start = performance.now();
				await learning.enter(taskId);
				try {
					const result = await runWindowsBatch(runtime, steps, 6000, extra.signal);
					await learning.record(taskId, 'windows', {action: 'batch', steps}, result, performance.now() - start);
					return result;
				} catch (error) {
					await learning.record(taskId, 'windows', {action: 'batch', steps}, {...jsonResult({ok: false, error_details: errorDetails(error)}), isError: true}, performance.now() - start);
					throw error;
				} finally {
					learning.leave(taskId);
				}
			}

			case 'finish': {
				const id = required(args.task_id, 'task_id');
				await learning.finish(id, required(args.outcome, 'outcome'), args.summary ?? '');
				await runtime.update({learningTaskId: id, learningFeedbackPending: true});
				return jsonResult({recorded: true, user_satisfaction: 'unknown', feedback_available: true});
			}

			case 'feedback':
				await learning.feedback(required(args.task_id, 'task_id'), required(args.satisfaction, 'satisfaction'), 'explicit_user_report');
				if (runtime.companion.state.learningTaskId === args.task_id) {
					await runtime.update({learningFeedbackPending: false});
				}

				return jsonResult({recorded: true});
			case 'status':
				return jsonResult(await learning.stats());
			case 'configure':
				await learning.configure(required(args.enabled, 'enabled'), required(args.retention_days, 'retention_days'));
				return jsonResult(await learning.stats());
			case 'forget':
				await learning.forget();
				await runtime.update({learningTaskId: '', learningFeedbackPending: false});
				return jsonResult({erased: true});
			case 'export': {
				const page = await learning.exportPage(args.offset, args.max_chars, args.version);
				return {content: [{type: 'text', text: JSON.stringify(page)}]};
			}
		}
	})));
}
