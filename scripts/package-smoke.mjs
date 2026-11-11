import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {connect} from './client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'release');
const archive = path.join(release, 'pokemon-companion-win32-x64.mcpb');
assert(fs.existsSync(archive), 'Run npm run package:windows first.');
const relocated = fs.mkdtempSync(path.join(release, '.verify-package-'));
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'exec', '--yes', '--package=@anthropic-ai/mcpb@2.1.2', '--', 'mcpb', 'unpack', archive, relocated], {cwd: root, stdio: 'inherit', windowsHide: true});
assert.equal(result.status, 0, 'Could not unpack the actual MCPB.');
let client;
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(relocated, 'manifest.json'), 'utf8'));
  assert.equal(manifest.server.type, 'binary');
  assert.deepEqual(manifest.compatibility.platforms, ['win32']);
  const command = manifest.server.mcp_config.command.replaceAll('${__dirname}', relocated);
  assert(fs.existsSync(command), 'Bundled Node runtime missing.');
  assert(fs.existsSync(path.join(relocated, 'backend/dist/windows/uia-worker.ps1')), 'Native worker missing.');
  assert(fs.existsSync(path.join(relocated, 'frontend/node_modules/electron/dist/electron.exe')), 'Electron runtime missing.');
  const scan = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      assert(entry.name !== '.env' && !entry.name.startsWith('.env.') && entry.name !== '.git', `Private source file included: ${entry.name}`);
      if (entry.isDirectory()) scan(path.join(directory, entry.name));
    }
  };
  scan(relocated);
  const connected = await connect({root: relocated, command, env: {...process.env,
    APPDATA: path.join(relocated, '.test-appdata'), LOCALAPPDATA: path.join(relocated, '.test-localappdata'), POKEMON_USER_DATA_DIR: path.join(relocated, '.test-userdata')}});
  client = connected.client;
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), ['desktop', 'computer', 'pokemon', 'windows', 'course', 'excel', 'learning']);
  assert.equal(tools.tools.find(tool => tool.name === 'windows').inputSchema.properties.action.default, 'batch');
  assert.deepEqual(manifest.tools.map(tool => tool.name).sort(), tools.tools.map(tool => tool.name).sort(), 'Bundle metadata omitted a live tool.');
  for (const file of ['backend/package.json', 'frontend/package.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'plugin.json']) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(relocated, file), 'utf8')).version, manifest.version, file + ' version differs from bundle.');
  }
  const guide = fs.readFileSync(path.join(relocated, 'AGENT_GUIDE.md'), 'utf8');
  assert(guide.startsWith('Package version: ' + manifest.version + '\nResponse contract version: 1\n'));
  assert(guide.includes('stopped_step') && guide.includes('window_ref') && guide.includes('user pause'));
  assert.equal(client.getServerVersion().version, manifest.version, 'MCP handshake version differs from bundle.');
  const status = await connected.call('desktop', {action: 'status'});
  assert.equal(status.structuredContent.native.ready, true, 'Bundled native worker is not ready.');
  assert.equal(status.structuredContent.contract_version, 1);
  assert.equal(status.structuredContent.server_version, manifest.version);
  assert.deepEqual(status.structuredContent.native.actions, tools.tools.find(tool => tool.name === 'windows').inputSchema.properties.action.enum.filter(action => action !== 'batch'));
  for (const pet of ['pikachu', 'riolu', 'lucario', 'clodsire', 'bulbasaur', 'charmander', 'squirtle', 'hello-kitty', 'kuromi']) {
    const selected = await connected.call('pokemon', {action: 'select', pet});
    assert.equal(selected.structuredContent.pet, pet);
  }
  assert(fs.existsSync(path.join(relocated, '.test-userdata')), 'Companion ignored its isolated profile folder.');
  const windows = await connected.call('windows', {steps: [{action: 'get_windows'}], max_chars: 2000});
  assert(windows.content.every((item) => item.type !== 'image'));
  assert.equal(JSON.parse(windows.content.find(item => item.type === 'text').text).completed, 1);
  const cursor = await connected.call('computer', {action: 'get_cursor_position'});
  assert(!cursor.isError);
  await connected.call('pokemon', {action: 'done', message: 'Standalone package verified!'});
  console.log('PASS: actual MCPB unpacked to a different path, bundled Node/Electron, native worker, all 9 companions, Windows API, cursor, no screenshots, no source secrets.');
} finally {
  await client?.close();
  // Remove only the exact verification directory created above, within release.
  assert.equal(path.dirname(fs.realpathSync(relocated)), fs.realpathSync(release));
  assert(path.basename(relocated).startsWith('.verify-package-'));
  fs.rmSync(relocated, {recursive: true, force: true});
}
