/** Optional macOS/Linux bridge to https://github.com/vercel-labs/agent-desktop (contract 2.6). */
import * as childProcess from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import type {RequestOptions, WindowsRequest} from './automation.js';

type Execution = {stdout: string; exitCode: number | null};
export type DesktopExecutor = (args: string[], signal: AbortSignal, input?: string) => Promise<Execution>;

// No shell, headed input, automatic installation, action retries or fallback on failure.
export const executeDesktop: DesktopExecutor = async (args, signal, input) => new Promise((resolve, reject) => {
	const child = childProcess.spawn(process.env.POKEMON_AGENT_DESKTOP || 'agent-desktop', args, {stdio: 'pipe', windowsHide: true, signal});
	let stdout = '';
	let stderr = '';
	child.stdout.setEncoding('utf8');
	child.stdout.on('data', (chunk: string) => {
		stdout += chunk;
		if (stdout.length > 2_000_000) {
			child.kill();
			reject(new Error('agent-desktop response exceeded the buffer limit; delivery may be uncertain. Do not replay input.'));
		}
	});
	child.stderr.on('data', (chunk: Buffer) => {
		stderr = (stderr + chunk.toString()).slice(-2000);
	});
	child.once('error', (error: NodeJS.ErrnoException) => {
		reject(error.code === 'ENOENT' ? new Error('macOS/Linux automation requires agent-desktop on PATH, with JSON contract 2.6.') : error);
	});
	child.stdin.on('error', reject);
	child.once('close', (exitCode) => {
		if (!stdout.trim()) {
			reject(new Error(`agent-desktop returned no JSON (exit ${String(exitCode)}): ${stderr}. Delivery may be uncertain; do not replay input.`));
		} else {
			resolve({stdout, exitCode});
		}
	});
	child.stdin.end(input);
});

const windowSchema = z.object({
	id: z.string().min(1), title: z.string().optional(), app_name: z.string().optional(), is_focused: z.boolean().optional(),
}).loose();
const dispositionSchema = z.object({
	delivery: z.enum(['delivered_verified', 'delivered_unverified', 'not_delivered', 'delivery_uncertain']),
	retry: z.enum(['safe', 'unsafe']),
}).loose();
const envelopeSchema = z.object({
	version: z.literal('2.6'), ok: z.boolean(), command: z.string(), data: z.unknown().optional(),
	error: z.object({code: z.string(), message: z.string(), disposition: dispositionSchema.optional()}).loose().optional(),
});

export class DesktopCommandError extends Error {
	constructor(readonly details: NonNullable<z.infer<typeof envelopeSchema>['error']>) {
		super(`agent-desktop ${details.code}: ${details.message}${details.disposition ? ` (${JSON.stringify(details.disposition)})` : ''}`);
	}
}

type TreeNode = {
	role: string; name?: string | undefined; value?: string | undefined; ref_id?: string | undefined;
	native_id?: {kind: string; value: string} | undefined; states?: string[] | undefined;
	available_actions?: string[] | undefined; children?: TreeNode[] | undefined; subtree_truncated?: boolean | undefined;
};
const treeSchema: z.ZodType<TreeNode> = z.lazy(() => z.object({
	role: z.string(), name: z.string().optional(), value: z.string().optional(), ref_id: z.string().optional(),
	native_id: z.object({kind: z.string(), value: z.string()}).optional(), states: z.array(z.string()).optional(),
	available_actions: z.array(z.string()).optional(), children: z.array(treeSchema).optional(), subtree_truncated: z.boolean().optional(),
}).loose());
const snapshotSchema = z.object({
	window: windowSchema, snapshot_id: z.string().regex(/^s[a-z0-9]+$/), complete: z.boolean(), tree: treeSchema,
	truncated: z.boolean().optional(), identity_unproven: z.boolean().optional(), nodes_observed: z.number().optional(),
});
const commands: Readonly<Record<string, string>> = {
	invoke: 'click', set_value: 'set-value', focus: 'focus', toggle: 'toggle', expand: 'expand', collapse: 'collapse', scroll: 'scroll', read_text: 'get',
};
const capabilities: Readonly<Record<string, string>> = {
	Click: 'invoke', SetValue: 'set_value', SetFocus: 'focus', Toggle: 'toggle', Expand: 'expand', Collapse: 'collapse', Scroll: 'scroll',
};
const roles: Readonly<Record<string, string>> = {
	button: 'Button', text: 'Text', textbox: 'Edit', textfield: 'Edit', text_field: 'Edit', entry: 'Edit',
	window: 'Window', group: 'Group', pane: 'Pane', tab: 'TabItem', checkbox: 'CheckBox', combobox: 'ComboBox', document: 'Document',
};
type Target = {ref: string; actions: string[]};
type Snapshot = {created: number; windowId: string; elements: Map<number, Target>};

export class CrossPlatformAutomation {
	private readonly snapshots = new Map<string, Snapshot>();
	private readonly pending = new Set<() => void>();
	constructor(
		private readonly execute: DesktopExecutor = executeDesktop,
		private readonly platform: string = process.platform,
		private readonly now: () => number = Date.now,
	) {}

	close(): void {
		for (const stop of this.pending) {
			stop();
		}

		this.snapshots.clear();
	}

	async request(args: WindowsRequest, options?: RequestOptions): Promise<Record<string, unknown>> {
		if (!['darwin', 'linux'].includes(this.platform)) {
			throw new Error(`Unsupported desktop platform: ${this.platform}.`);
		}

		const controller = new AbortController();
		const timeoutMs = Math.max(1, Math.min(options?.timeoutMs ?? 20_000, 20_000));
		const deadline = this.now() + timeoutMs;
		let interruption: Error | undefined;
		const stop = (message: string) => {
			interruption ??= new Error(`${message} Delivery may be uncertain if started; do not replay input. Call get_ui again.`);
			controller.abort();
		};

		const cancel = () => {
			stop('Computer action cancelled.');
		};

		const closed = () => {
			stop('Desktop automation closed.');
		};

		this.pending.add(closed);

		const check = () => {
			if (options?.signal?.aborted) {
				cancel();
			}

			if (options?.paused()) {
				stop('Computer control is paused by the user.');
			}

			if (this.now() >= deadline) {
				stop(options?.timeoutError ?? 'Desktop automation timed out.');
			}

			if (interruption) {
				throw interruption;
			}
		};

		const timer = setTimeout(() => {
			stop(options?.timeoutError ?? 'Desktop automation timed out.');
		}, timeoutMs);
		const pauseTimer = options ? setInterval(checkPause, 50) : undefined;
		function checkPause() {
			if (options?.paused()) {
				stop('Computer control is paused by the user.');
			}
		}

		options?.signal?.addEventListener('abort', cancel, {once: true});
		const call = async (command: string, parameters: string[], input?: string) => {
			check();
			const timeoutFlag = command === 'launch' ? '--timeout' : '--timeout-ms';
			const timeoutArgs = ['get', 'focus-window'].includes(command) ? [] : [timeoutFlag, String(Math.max(1, Math.floor(deadline - this.now())))];
			let onAbort: () => void = () => undefined;
			const interrupted = new Promise<never>((_resolve, reject) => {
				onAbort = () => {
					reject(interruption ?? new Error('Desktop automation interrupted.'));
				};

				controller.signal.addEventListener('abort', onAbort, {once: true});
			});
			let execution: Execution;
			try {
				execution = await Promise.race([this.execute([command, ...parameters, ...timeoutArgs], controller.signal, input), interrupted]);
			} finally {
				controller.signal.removeEventListener('abort', onAbort);
			}

			check();
			const envelope = envelopeSchema.parse(JSON.parse(execution.stdout) as unknown);
			if (envelope.command !== command) {
				throw new Error('agent-desktop returned a mismatched command.');
			}

			if (!envelope.ok) {
				if (!envelope.error || envelope.data !== undefined) {
					throw new Error('agent-desktop returned an invalid error envelope.');
				}

				throw new DesktopCommandError(envelope.error);
			}

			if (execution.exitCode !== 0 || envelope.error || envelope.data === undefined) {
				throw new Error('agent-desktop returned an invalid success envelope; do not replay input.');
			}

			return envelope.data;
		};

		try {
			check();
			if (args.action === 'get_windows') {
				const windows = windowSchema.array().parse(await call('list-windows', [])).map((window) => ({
					...window, title: window.title ?? '', process: window.app_name ?? '', active: window.is_focused ?? false,
				})).filter((window) => !args.query || `${window.title} ${window.process}`.toLowerCase().includes(args.query.toLowerCase()));
				return {windows};
			}

			if (args.action === 'get_ui') {
				if (!args.window_id) {
					throw new Error('get_ui requires window_id.');
				}

				const data = snapshotSchema.parse(await call('snapshot', ['--window-id', args.window_id, '--max-depth', String(args.max_depth ?? 24)]));
				if (data.window.id !== args.window_id) {
					throw new Error('agent-desktop snapshot belongs to another window.');
				}

				return this.capture(data, args);
			}

			if (args.action === 'activate') {
				if (!args.window_id) {
					throw new Error('activate requires window_id.');
				}

				const data = z.object({focused: windowSchema}).loose().parse(await call('focus-window', ['--window-id', args.window_id]));
				if (data.focused.id !== args.window_id) {
					throw new Error('agent-desktop focused another window.');
				}

				return {ok: true, ...data};
			}

			if (args.action === 'launch') {
				if (!args.text || args.text.startsWith('-') || /^https?:/i.test(args.text) || /[\\/:]/.test(args.text)) {
					throw new Error('macOS/Linux launch supports an application name only; URLs and paths are not supported by this bridge.');
				}

				const data = z.object({
					app: z.string(), pid: z.number(), process_instance: z.string().nullable(), window: windowSchema.optional(),
				}).loose().parse(await call('launch', [args.text]));
				return {...data, started: args.text, query: data.app};
			}

			const command = commands[args.action];
			if (!command) {
				throw new Error(`macOS/Linux automation does not support ${args.action}.`);
			}

			const target = this.target(args);
			if (!target.actions.includes(args.action)) {
				throw new Error(`Observed control does not support ${args.action}. Call get_ui again.`);
			}

			const parameters = [target.ref];
			if (args.action === 'set_value') {
				if (args.text === undefined) {
					throw new Error('set_value requires text.');
				}

				parameters.push('--stdin');
			} else if (args.action === 'scroll') {
				if (!['up', 'down', 'left', 'right'].includes(args.direction ?? '')) {
					throw new Error('scroll requires direction.');
				}

				parameters.push('--direction', args.direction!);
			} else if (args.action === 'read_text') {
				parameters.push('--property', 'text');
			}

			const raw = await call(command, parameters, args.action === 'set_value' ? args.text : undefined);
			if (args.action === 'read_text') {
				const data = z.object({property: z.literal('text'), ref: z.literal(target.ref), value: z.string()}).parse(raw);
				return {text: data.value, source: 'agent-desktop get (may use saved snapshot text)'};
			}

			const data = z.object({action: z.literal(command), disposition: dispositionSchema}).loose().parse(raw);
			if (data.disposition.delivery === 'delivery_uncertain') {
				throw new Error('agent-desktop returned uncertain delivery as success; do not replay input.');
			}

			const report: Record<string, unknown> = {ok: true, ...data};
			for (const key of Object.keys(data).filter((key) => !['action', 'disposition'].includes(key))) {
				if (JSON.stringify(report).length <= (args.max_chars ?? 6000)) {
					break;
				}

				Reflect.deleteProperty(report, key);
				report.truncated = true;
				report.details_omitted = true;
			}

			return report;
		} catch (error) {
			if (interruption) {
				this.close();
				throw interruption;
			}

			throw error;
		} finally {
			this.pending.delete(closed);
			clearTimeout(timer);
			clearInterval(pauseTimer);
			options?.signal?.removeEventListener('abort', cancel);
		}
	}

	private expire(): void {
		for (const [id, snapshot] of this.snapshots) {
			if (this.now() - snapshot.created >= 120_000) {
				this.snapshots.delete(id);
			}
		}
	}

	private target(args: WindowsRequest): Target {
		this.expire();
		const snapshot = args.snapshot ? this.snapshots.get(args.snapshot) : undefined;
		if (!snapshot || (args.window_id !== undefined && args.window_id !== snapshot.windowId)) {
			throw new Error('Snapshot expired, missing or belongs to another window. Call get_ui again.');
		}

		const target = args.element_id ? snapshot.elements.get(args.element_id) : undefined;
		if (!target) {
			throw new Error('Element is absent from this snapshot. Call get_ui again.');
		}

		return target;
	}

	private capture(data: z.infer<typeof snapshotSchema>, args: WindowsRequest): Record<string, unknown> {
		this.expire();
		if (this.snapshots.size >= 8) {
			this.snapshots.delete(this.snapshots.keys().next().value!);
		}

		const id = randomBytes(16).toString('hex');
		const snapshot: Snapshot = {created: this.now(), windowId: data.window.id, elements: new Map()};
		const nodes: Record<string, unknown>[] = [];
		const pending = [data.tree];
		let scanned = 0;
		let partial = !data.complete || Boolean(data.truncated);
		while (pending.length && scanned < 2500) {
			const node = pending.pop()!;
			scanned += 1;
			partial ||= Boolean(node.subtree_truncated);
			const states = node.states ?? [];
			if (states.some((state) => ['password', 'protected', 'secure', 'sensitive', 'hidden', 'offscreen'].includes(state.toLowerCase()))) {
				continue;
			}

			if (node.children) {
				pending.push(...node.children.toReversed());
			}

			const role = roles[node.role.toLowerCase()] ?? node.role;
			const name = node.name ?? '';
			const automationId = node.native_id?.value ?? '';
			if (args.query && !`${name} ${automationId}`.toLowerCase().includes(args.query.toLowerCase())) {
				continue;
			}

			if (args.control_type && role.toLowerCase() !== args.control_type.toLowerCase()) {
				continue;
			}

			const elementId = nodes.length + 1;
			const enabled = !states.some((state) => ['disabled', 'unavailable'].includes(state.toLowerCase()));
			const actions = enabled && node.ref_id ? (node.available_actions ?? []).flatMap((action) => capabilities[action] ? [capabilities[action]] : []) : [];
			if (enabled && node.ref_id) {
				actions.push('read_text');
			}

			if (node.ref_id) {
				if (!new RegExp(`^@${data.snapshot_id}:e[1-9][0-9]*$`).test(node.ref_id)) {
					throw new Error('agent-desktop returned a ref from another snapshot.');
				}

				snapshot.elements.set(elementId, {ref: node.ref_id, actions});
			}

			nodes.push({
				id: elementId, role, name: name.slice(0, 160), actions, enabled, states,
				...(node.ref_id ? {ref: `@s${id}:e${elementId}`} : {}),
				...(automationId ? {automation_id: automationId.slice(0, 100)} : {}),
				...(node.value !== undefined ? {value: node.value.slice(0, 160), value_clipped: node.value.length > 160} : {}),
			});
		}

		this.snapshots.set(id, snapshot);
		return {
			window: data.window, snapshot: id, nodes, matched: nodes.length, scanned, complete: data.complete,
			truncated: partial || pending.length > 0, identity_unproven: data.identity_unproven ?? false,
		};
	}
}
