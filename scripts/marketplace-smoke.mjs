import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Client} from '../backend/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../backend/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'release');
const descriptor = JSON.parse(fs.readFileSync(path.join(root, 'plugins/pokemon-companion/runtime.json'), 'utf8'));
const version = descriptor.package_version;
assert.equal(descriptor.contract_version, 1);
assert.equal(version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
const codexPlugin = JSON.parse(fs.readFileSync(path.join(root, 'plugins/pokemon-companion/.codex-plugin/plugin.json'), 'utf8'));
const claudePlugin = JSON.parse(fs.readFileSync(path.join(root, 'plugins/pokemon-companion/.claude-plugin/plugin.json'), 'utf8'));
assert.equal(codexPlugin.version, claudePlugin.version, 'Client wrapper versions differ.');
assert(claudePlugin.mcpServers.includes('/releases/download/v' + version + '/'), 'Claude wrapper refers to another runtime release.');
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-marketplace-'));
const cache = path.join(isolated, 'pokemon-companion/packages/v' + version);
const client = new Client({name: 'pokemon-marketplace-test', version: '0.1.0'});
const transport = new StdioClientTransport({command: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'plugins/pokemon-companion/scripts/launch.ps1')], env: {...process.env, LOCALAPPDATA: isolated, APPDATA: path.join(isolated, 'appdata'), POKEMON_USER_DATA_DIR: path.join(isolated, 'userdata')}, stderr: 'inherit'});
try {
  if (!process.argv.includes('--download')) fs.cpSync(path.join(release, 'pokemon-companion-win32-x64'), cache, {recursive: true});
  await client.connect(transport, {timeout: 300000});
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), ['desktop', 'computer', 'pokemon', 'windows', 'course', 'excel']);
  const status = await client.callTool({name: 'desktop', arguments: {action: 'status'}});
  assert.equal(status.structuredContent.native.ready, true);
  assert.equal(status.structuredContent.server_version, version);
  const selected = await client.callTool({name: 'pokemon', arguments: {action: 'select', pet: 'pikachu'}});
  assert(!selected.isError);
  assert.equal(selected.structuredContent.pet, 'pikachu');
  assert(fs.existsSync(path.join(isolated, 'userdata')), 'Marketplace companion ignored its isolated profile folder.');
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
