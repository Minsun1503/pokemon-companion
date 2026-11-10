import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import type {PokemonRuntime} from '../pokemon/runtime.js';
import {errorDetails, rejectedAction} from '../utils/errors.js';
import {jsonResult} from '../utils/response.js';
import {timedCall} from '../utils/timing.js';
import {windowsActions} from '../windows/actions.js';
import {serverVersion} from '../version.js';

/** Read-only readiness check; permissions remain target-specific. */
export async function desktopStatus(runtime: PokemonRuntime, signal?: AbortSignal) {
	const status = {
		contract_version: 1,
		server_version: serverVersion,
		platform: process.platform,
		node_version: process.versions.node,
		paused: runtime.companion.state.paused,
		native: {supported: process.platform === 'win32', ready: false, actions: process.platform === 'win32' ? windowsActions : []},
		permissions: 'not_checked_per_target',
		surfaces: process.platform === 'win32' ? ['application_windows'] : [],
		limitations: ['Readiness does not establish access to every application or secure desktop.', 'Screenshots and physical coordinates cover the primary display.', 'This probe checks the Windows native worker. macOS/Linux use the optional agent-desktop 2.6 bridge, whose readiness is not probed here.'],
	};
	if (process.platform !== 'win32') {
		return status;
	}

	try {
		const deadline = performance.now() + 5000;
		const probe = await runtime.exclusive(async () => runtime.windows.request({action: 'status'}, {
			signal, timeoutMs: Math.max(1, deadline - performance.now()), paused: () => false, timeoutError: 'Desktop worker readiness check timed out.',
		}), {signal, queueTimeoutMs: 5000});
		if (probe.protocol_version !== 1 || probe.worker !== 'ready') {
			throw rejectedAction('INCOMPATIBLE_WORKER', 'The native worker did not report the expected protocol.');
		}

		return {...status, native: {...status.native, ready: true, probe}};
	} catch (error) {
		return {...status, native: {...status.native, error: 'Desktop readiness check did not complete. If the worker cannot start, rebuild its native files and check its runtime installation.', error_details: errorDetails(error)}};
	}
}

export function registerDesktop(server: McpServer, runtime: PokemonRuntime): void {
	server.registerTool('desktop', {
		title: 'Desktop Readiness',
		description: 'Read-only desktop backend status, distinct from pet status. Reports platform, native worker readiness, supported actions/surfaces, pause state and known limits. The probe is bounded to five seconds including queue time, sends no input and does not request permissions. Readiness is not proof of access to an elevated app, secure desktop, or an individual control.',
		inputSchema: z.object({action: z.literal('status')}).strict(),
		annotations: {readOnlyHint: true},
	}, async (_args, extra) => timedCall('desktop', 'status', async () => jsonResult(await desktopStatus(runtime, extra.signal))));
}
