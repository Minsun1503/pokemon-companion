import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Client} from '../backend/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../backend/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'release');
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-marketplace-'));
const cache = path.join(isolated, 'pokemon-companion/packages/v0.1.0');
if (!process.argv.includes('--download')) fs.cpSync(path.join(release, 'pokemon-companion-win32-x64'), cache, {recursive: true});
const client = new Client({name: 'pokemon-marketplace-test', version: '0.1.0'});
const transport = new StdioClientTransport({command: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'plugins/pokemon-companion/scripts/launch.ps1')], env: {...process.env, LOCALAPPDATA: isolated, APPDATA: path.join(isolated, 'appdata')}, stderr: 'inherit'});
try {
  await client.connect(transport, {timeout: 300000});
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), ['computer', 'pokemon', 'windows', 'course', 'excel']);
  const selected = await client.callTool({name: 'pokemon', arguments: {action: 'select', pet: 'pikachu'}});
  assert(!selected.isError);
  assert.equal(selected.structuredContent.pet, 'pikachu');
  const windows = await client.callTool({name: 'windows', arguments: {action: 'get_windows', max_chars: 1000}});
  assert(!windows.isError);
  assert(windows.content.every((item) => item.type !== 'image'));
  console.log('PASS: GitHub marketplace launcher relays live MCP through PowerShell into the cached bundled runtime; Pokemon and Windows API tools work.');
} catch (error) {
  console.error('Marketplace verification failed:', error.message);
  throw error;
} finally {
  await client.close();
  assert.equal(path.dirname(fs.realpathSync(isolated)), fs.realpathSync(os.tmpdir()));
  assert(path.basename(isolated).startsWith('pc-marketplace-'));
  fs.rmSync(isolated, {recursive: true, force: true, maxRetries: 12, retryDelay: 500});
}
