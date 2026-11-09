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
  const connected = await connect({root: relocated, command});
  client = connected.client;
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), ['computer', 'pokemon', 'windows', 'course', 'excel']);
  for (const pet of ['pikachu', 'riolu', 'lucario', 'clodsire', 'bulbasaur', 'charmander', 'squirtle']) {
    const selected = await connected.call('pokemon', {action: 'select', pet});
    assert.equal(selected.structuredContent.pet, pet);
  }
  const windows = await connected.call('windows', {action: 'get_windows', max_chars: 2000});
  assert(windows.content.every((item) => item.type !== 'image'));
  const cursor = await connected.call('computer', {action: 'get_cursor_position'});
  assert(!cursor.isError);
  await connected.call('pokemon', {action: 'done', message: 'Standalone package verified!'});
  console.log('PASS: actual MCPB unpacked to a different path, bundled Node/Electron, native worker, all 7 Pokémon, Windows API, cursor, no screenshots, no source secrets.');
} finally {
  await client?.close();
  // Remove only the exact verification directory created above, within release.
  assert.equal(path.dirname(fs.realpathSync(relocated)), fs.realpathSync(release));
  assert(path.basename(relocated).startsWith('.verify-package-'));
  fs.rmSync(relocated, {recursive: true, force: true});
}
