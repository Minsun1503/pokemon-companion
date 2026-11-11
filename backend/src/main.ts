#!/usr/bin/env node
import {execSync} from 'node:child_process';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, timingSafeEqual} from 'node:crypto';

// Clear macOS quarantine attributes from native binaries before importing them
// This is needed for MCPB packages downloaded from the internet
if (process.platform === 'darwin') {
	try {
		const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
		execSync(`xattr -cr "${projectRoot}/node_modules"`, {stdio: 'ignore'});
	} catch {
		// Ignore errors - xattr may not exist or may fail on some files
	}
}

import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import express from 'express';
import {createServer} from './index.js';
import {PokemonRuntime} from './pokemon/runtime.js';

function setupSignalHandlers(cleanup: () => Promise<void>): void {
	process.on('SIGINT', async () => {
		await cleanup();
		process.exit(0);
	});
	process.on('SIGTERM', async () => {
		await cleanup();
		process.exit(0);
	});
}

(async () => {
	const transport = process.env.MCP_TRANSPORT || 'stdio';
	const token = process.env.POKEMON_HTTP_TOKEN;
	if (transport === 'http' && (!token || token.length < 32)) {
		console.error('HTTP transport requires POKEMON_HTTP_TOKEN with at least 32 characters. Use stdio or configure a Bearer token.');
		process.exit(1);
	}

	const runtime = new PokemonRuntime();
	runtime.windows.warm();

	if (transport === 'stdio') {
		const server = createServer(runtime);
		const cleanup = async () => {
			await runtime.close();
			await server.close();
		};

		setupSignalHandlers(cleanup);
		process.stdin.once('end', () => {
			void cleanup();
		});

		const stdioTransport = new StdioServerTransport();
		await server.connect(stdioTransport as Transport);
		console.error('Computer Use MCP server running on stdio');
	} else if (transport === 'http') {
		const app = express();
		const expected = createHash('sha256').update(token!).digest();
		app.use('/mcp', (req, res, next) => {
			const authorization = req.headers.authorization ?? '';
			const supplied = createHash('sha256').update(authorization.startsWith('Bearer ') ? authorization.slice(7) : '').digest();
			if (!timingSafeEqual(expected, supplied)) {
				res.status(401).json({error: 'Bearer authentication required.'});
				return;
			}

			next();
		});
		app.use(express.json());

		// Stateless: fresh server + transport per request — sharing either misroutes responses on concurrent requests with colliding JSON-RPC IDs (GHSA-345p-7cg4-v4c7).
		app.post('/mcp', async (req, res) => {
			const server = createServer(runtime);
			const httpTransport = new StreamableHTTPServerTransport({
				enableJsonResponse: true,
			});
			res.on('close', () => {
				void server.close();
			});
			await server.connect(httpTransport as Transport);
			await httpTransport.handleRequest(req, res, req.body);
		});

		const port = parseInt(process.env.PORT || '3000', 10);
		const httpServer = app.listen(port, '127.0.0.1', () => {
			console.error(`Computer Use MCP server running on http://localhost:${port}/mcp`);
			console.error('HTTP MCP requests require Bearer authentication.');
		});

		setupSignalHandlers(async () => {
			await runtime.close();
			httpServer.close();
		});
	} else {
		console.error(`Unknown transport: ${transport}. Use MCP_TRANSPORT=stdio or MCP_TRANSPORT=http`);
		process.exit(1);
	}

	void runtime.companion.start().catch((error: unknown) => {
		console.error('Pokémon desktop:', error instanceof Error ? error.message : String(error));
	});
})();
