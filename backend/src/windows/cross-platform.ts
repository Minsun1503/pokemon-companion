/**
 * Cross-platform desktop automation adapter for macOS and Linux.
 * 
 * Credit: Architecture and ref conventions adapted from Vercel Labs agent-desktop
 * (https://github.com/vercel-labs/agent-desktop).
 */

import * as childProcess from 'node:child_process';
import {promisify} from 'node:util';
import type {WindowsRequest} from './automation.js';

async function execFileAsync(cmd: string, args: string[]): Promise<{stdout: string; stderr: string}> {
	const fn = childProcess.execFile ? promisify(childProcess.execFile) : null;
	if (!fn) {
		throw new Error(`execFile is unavailable in current environment.`);
	}
	return fn(cmd, args) as Promise<{stdout: string; stderr: string}>;
}

let agentDesktopCached: boolean | undefined;

/**
 * Check if the `agent-desktop` CLI (from Vercel Labs) is installed and available in PATH.
 */
export function isAgentDesktopAvailable(): boolean {
	if (agentDesktopCached !== undefined) {
		return agentDesktopCached;
	}

	try {
		if (typeof childProcess.spawnSync !== 'function') {
			agentDesktopCached = false;
			return false;
		}
		const checkCmd = process.platform === 'win32' ? 'where' : 'which';
		const result = childProcess.spawnSync(checkCmd, ['agent-desktop'], {encoding: 'utf8', timeout: 2000});
		agentDesktopCached = result.status === 0;
	} catch {
		agentDesktopCached = false;
	}

	return agentDesktopCached;
}

/**
 * Flatten an agent-desktop accessibility tree into pokemon-companion nodes format.
 */
function flattenAgentDesktopTree(
	node: Record<string, any>,
	snapshotId: string,
	nodes: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
	if (!node || typeof node !== 'object') {
		return nodes;
	}

	if (node.ref_id || node.name) {
		const id = nodes.length + 1;
		const rawActions: string[] = Array.isArray(node.available_actions) ? node.available_actions : [];
		const actions = rawActions.map((action) => {
			const lower = action.toLowerCase();
			return lower === 'click' ? 'invoke' : lower;
		});

		nodes.push({
			id,
			role: node.role || 'Unknown',
			name: String(node.name || '').slice(0, 160),
			actions,
			ref: node.ref_id || `@s${snapshotId}:e${id}`,
			...(node.value !== undefined ? {value: String(node.value).slice(0, 160)} : {}),
		});
	}

	if (Array.isArray(node.children)) {
		for (const child of node.children) {
			flattenAgentDesktopTree(child, snapshotId, nodes);
		}
	}

	return nodes;
}

/**
 * Run macOS desktop automation through agent-desktop CLI or native osascript fallback.
 */
async function runDarwinRequest(args: WindowsRequest): Promise<Record<string, unknown>> {
	// Mode A: agent-desktop CLI from Vercel Labs if installed
	if (isAgentDesktopAvailable()) {
		try {
			if (args.action === 'get_windows') {
				const {stdout} = await execFileAsync('agent-desktop', ['list-windows']);
				const parsed = JSON.parse(stdout);
				const windows = Array.isArray(parsed) ? parsed : parsed.data?.windows || [];
				return {windows};
			}

			if (args.action === 'get_ui') {
				const cliArgs = ['snapshot'];
				if (args.window_id) {
					cliArgs.push('--window-id', args.window_id);
				}
				if (args.query) {
					cliArgs.push('--app', args.query);
				}

				const {stdout} = await execFileAsync('agent-desktop', cliArgs);
				const parsed = JSON.parse(stdout);
				const snapshotId = parsed.data?.snapshot_id || 's' + Date.now().toString(16);
				const nodes = flattenAgentDesktopTree(parsed.data?.tree, snapshotId);
				return {
					window: {id: args.window_id || '1', title: args.query || 'Desktop App'},
					snapshot: snapshotId,
					nodes,
					matched: nodes.length,
					truncated: false,
					scanned: nodes.length,
				};
			}

			if (args.action === 'invoke' && args.ref) {
				await execFileAsync('agent-desktop', ['click', args.ref]);
				return {ok: true};
			}

			if (args.action === 'set_value' && args.ref) {
				await execFileAsync('agent-desktop', ['set-value', args.ref, args.text ?? '']);
				return {ok: true};
			}

			if (args.action === 'activate' && args.window_id) {
				await execFileAsync('agent-desktop', ['window-focus', args.window_id]);
				return {ok: true};
			}
		} catch (error) {
			// Fall through to native osascript on failure
		}
	}

	// Mode B: Native macOS JXA / AppleScript fallback (zero external dependencies)
	if (args.action === 'get_windows') {
		const script = `
			const se = Application("System Events");
			const procs = se.processes.whose({backgroundOnly: false})();
			const windows = [];
			for (let i = 0; i < procs.length; i++) {
				const p = procs[i];
				try {
					const wins = p.windows();
					for (let j = 0; j < wins.length; j++) {
						const title = wins[j].name() || p.name();
						windows.push({
							id: String(p.id()),
							title: title.slice(0, 200),
							process: p.name(),
							active: p.frontmost()
						});
					}
				} catch (e) {}
			}
			JSON.stringify(windows);
		`;
		try {
			const {stdout} = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', script]);
			const rawWindows = JSON.parse(stdout.trim());
			let windows = rawWindows;
			if (args.query) {
				const q = args.query.toLowerCase();
				windows = rawWindows.filter((w: any) =>
					(w.title && w.title.toLowerCase().includes(q)) ||
					(w.process && w.process.toLowerCase().includes(q)),
				);
			}
			return {windows};
		} catch {
			return {windows: []};
		}
	}

	if (args.action === 'activate') {
		if (!args.window_id) {
			throw new Error('activate requires window_id.');
		}
		const script = `tell application "System Events" to set frontmost of (first process whose id is ${args.window_id}) to true`;
		try {
			await execFileAsync('osascript', ['-e', script]);
			return {ok: true};
		} catch (error) {
			throw new Error(`macOS activate failed for process id ${args.window_id}: ${String(error)}`);
		}
	}

	if (args.action === 'launch') {
		if (!args.text) {
			throw new Error('launch requires target URL or application name.');
		}
		await execFileAsync('open', [args.text]);
		return {started: args.text};
	}

	if (args.action === 'get_ui') {
		const windowId = args.window_id ?? '0';
		const script = `
			const se = Application("System Events");
			let proc;
			try { proc = se.processes.byId(${windowId}); } catch(e) {}
			if (!proc) {
				const procs = se.processes.whose({backgroundOnly: false})();
				proc = procs.length > 0 ? procs[0] : null;
			}
			const nodes = [];
			if (proc) {
				try {
					const wins = proc.windows();
					if (wins.length > 0) {
						const items = wins[0].entireContents();
						const limit = Math.min(items.length, 60);
						for (let i = 0; i < limit; i++) {
							const el = items[i];
							try {
								const name = el.name() || el.description() || "";
								const role = el.role() || "UIElement";
								nodes.push({
									id: i + 1,
									role: role,
									name: name.slice(0, 160),
									actions: ["invoke"]
								});
							} catch(err) {}
						}
					}
				} catch(err) {}
			}
			JSON.stringify(nodes);
		`;
		try {
			const {stdout} = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', script]);
			const nodes = JSON.parse(stdout.trim());
			const snapshotId = 's' + Date.now().toString(16).slice(-8);
			for (const node of nodes) {
				node.ref = `@${snapshotId}:e${node.id}`;
			}
			return {
				window: {id: windowId, title: 'macOS Application'},
				snapshot: snapshotId,
				nodes,
				matched: nodes.length,
				truncated: false,
				scanned: nodes.length,
			};
		} catch {
			return {window: {id: windowId}, snapshot: 's' + Date.now().toString(16), nodes: [], matched: 0, truncated: false, scanned: 0};
		}
	}

	return {ok: true};
}

/**
 * Run Linux desktop automation through agent-desktop CLI or wmctrl / xdotool fallback.
 */
async function runLinuxRequest(args: WindowsRequest): Promise<Record<string, unknown>> {
	// Mode A: agent-desktop CLI from Vercel Labs if installed
	if (isAgentDesktopAvailable()) {
		try {
			if (args.action === 'get_windows') {
				const {stdout} = await execFileAsync('agent-desktop', ['list-windows']);
				const parsed = JSON.parse(stdout);
				const windows = Array.isArray(parsed) ? parsed : parsed.data?.windows || [];
				return {windows};
			}

			if (args.action === 'get_ui') {
				const cliArgs = ['snapshot'];
				if (args.window_id) cliArgs.push('--window-id', args.window_id);
				if (args.query) cliArgs.push('--app', args.query);
				const {stdout} = await execFileAsync('agent-desktop', cliArgs);
				const parsed = JSON.parse(stdout);
				const snapshotId = parsed.data?.snapshot_id || 's' + Date.now().toString(16);
				const nodes = flattenAgentDesktopTree(parsed.data?.tree, snapshotId);
				return {
					window: {id: args.window_id || '1', title: args.query || 'Desktop App'},
					snapshot: snapshotId,
					nodes,
					matched: nodes.length,
					truncated: false,
					scanned: nodes.length,
				};
			}

			if (args.action === 'invoke' && args.ref) {
				await execFileAsync('agent-desktop', ['click', args.ref]);
				return {ok: true};
			}

			if (args.action === 'set_value' && args.ref) {
				await execFileAsync('agent-desktop', ['set-value', args.ref, args.text ?? '']);
				return {ok: true};
			}

			if (args.action === 'activate' && args.window_id) {
				await execFileAsync('agent-desktop', ['window-focus', args.window_id]);
				return {ok: true};
			}
		} catch (error) {
			// Fall through to native fallback
		}
	}

	// Mode B: Native Linux utilities (wmctrl, xdotool, xdg-open)
	if (args.action === 'get_windows') {
		try {
			const {stdout} = await execFileAsync('wmctrl', ['-l', '-p']);
			const lines = stdout.split('\n').filter(Boolean);
			let windows = lines.map((line) => {
				const parts = line.trim().split(/\s+/);
				const id = parts[0] || '';
				const pid = parts[2] || '';
				const title = parts.slice(4).join(' ');
				return {id, pid, title, process: pid, active: false};
			});
			if (args.query) {
				const q = args.query.toLowerCase();
				windows = windows.filter((w) => w.title.toLowerCase().includes(q) || w.process.includes(q));
			}
			return {windows};
		} catch {
			return {windows: []};
		}
	}

	if (args.action === 'activate') {
		if (!args.window_id) {
			throw new Error('activate requires window_id.');
		}
		try {
			await execFileAsync('wmctrl', ['-i', '-a', args.window_id]);
		} catch {
			await execFileAsync('xdotool', ['windowactivate', args.window_id]);
		}
		return {ok: true};
	}

	if (args.action === 'launch') {
		if (!args.text) {
			throw new Error('launch requires target URL or application.');
		}
		await execFileAsync('xdg-open', [args.text]);
		return {started: args.text};
	}

	return {ok: true, nodes: [], snapshot: 's' + Date.now().toString(16), matched: 0, truncated: false, scanned: 0};
}

/**
 * Route request to the appropriate platform handler.
 */
export async function runCrossPlatformRequest(args: WindowsRequest): Promise<Record<string, unknown>> {
	if (process.platform === 'darwin') {
		return runDarwinRequest(args);
	}
	if (process.platform === 'linux') {
		return runLinuxRequest(args);
	}
	throw new Error(`Unsupported desktop platform: ${process.platform}. Cross-platform automation supports Windows, macOS (darwin), and Linux.`);
}
