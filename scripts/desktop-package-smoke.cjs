const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync, spawnSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');
const release = path.join(root, 'release');
const version = require('../package.json').version;
const platform = process.platform;
const name = `pokemon-companion-${version}-${{win32: 'windows', darwin: 'macos', linux: 'linux'}[platform]}-${process.arch}`;
const zip = path.join(release, name + '.zip');

async function main() {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  assert.equal(fs.readFileSync(zip + '.sha256', 'utf8'), `${digest}  ${name}.zip\n`);
  const scratch = fs.mkdtempSync(path.join(release, '.desktop-verify-'));
  let passed = false;
  try {
    if (platform === 'win32') {
      const quote = value => "'" + value.replace(/'/g, "''") + "'";
      const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory(${quote(zip)}, ${quote(scratch)})`;
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {windowsHide: true});
    } else if (platform === 'darwin') {
      execFileSync('ditto', ['-x', '-k', zip, scratch]);
    } else {
      execFileSync('unzip', ['-q', zip, '-d', scratch]);
    }
    const extracted = path.join(scratch, name);
    const app = path.join(extracted, 'Pokemon Companion.app');
    const appRoot = platform === 'darwin' ? path.join(app, 'Contents/Resources/app') : extracted;
    const executable = platform === 'win32' ? path.join(extracted, 'Pokemon Companion.exe')
      : platform === 'darwin' ? path.join(app, 'Contents/MacOS/Pokemon Companion') : path.join(extracted, 'Pokemon Companion');
    const node = path.join(appRoot, 'runtime', platform === 'win32' ? 'node.exe' : 'node');
    assert.equal(execFileSync(node, ['--version'], {encoding: 'utf8', windowsHide: true}).trim(), 'v24.16.0');
    const info = JSON.parse(fs.readFileSync(path.join(extracted, 'build-info.json')));
    assert.equal(info.version, version);
    assert.equal(info.platform, platform);
    assert.equal(info.arch, process.arch);
    assert.equal(info.chatEnabled, false);
    const settings = JSON.parse(fs.readFileSync(path.join(appRoot, 'frontend/config/setting.json')));
    assert.equal(settings.ai.ollama.baseUrl, 'http://localhost:11434', 'A developer connection was included in the release');
    const scan = directory => {
      for (const item of fs.readdirSync(directory, {withFileTypes: true})) {
        assert(!item.name.startsWith('.env') && item.name !== '.git' && item.name !== 'companion_chats.json', `Private data included: ${item.name}`);
        if (item.isDirectory()) scan(path.join(directory, item.name));
      }
    };
    scan(extracted);
    for (const pet of ['hello-kitty', 'kuromi']) {
      for (const file of ['sprites.json', 'animations/run_side.gif', 'animations/typing.gif']) {
        assert.deepEqual(fs.readFileSync(path.join(appRoot, 'frontend/pets', pet, file)), fs.readFileSync(path.join(root, 'frontend/pets', pet, file)), `${pet}/${file} was not rebuilt`);
      }
    }
    if (platform === 'darwin') execFileSync('codesign', ['--verify', '--deep', '--strict', app]);
    const profile = path.join(scratch, 'test-profile');
    const launched = spawnSync(executable, ['--smoke-test'], {
      cwd: scratch, env: {...process.env, POKEMON_STANDALONE_USER_DATA_DIR: profile},
      windowsHide: true, encoding: 'utf8', timeout: 45000,
    });
    const log = path.join(profile, 'app.log');
    assert.equal(launched.status, 0, `Native launcher did not start and close the actual companion: ${launched.error || ''}\n${launched.stderr || ''}\n${fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''}`);
    if (platform === 'win32') assert(fs.readFileSync(log, 'utf8').includes('Pokémon Companion is ready.'), 'Launcher skipped app startup');
    const config = path.join(scratch, 'mcp-config');
    execFileSync(node, [path.join(appRoot, 'scripts/config.cjs'), '--output', config], {windowsHide: true});
    const generated = JSON.parse(fs.readFileSync(path.join(config, 'claude-desktop.json'))).mcpServers['pokemon-computer'];
    assert.equal(fs.realpathSync(generated.command), fs.realpathSync(node));
    assert.equal(generated.args[0], path.join(appRoot, 'backend/dist/main.js'));
    const sdk = path.join(appRoot, 'backend/node_modules/@modelcontextprotocol/sdk/dist/esm/client');
    const {Client} = await import(pathToFileURL(path.join(sdk, 'index.js')).href);
    const {StdioClientTransport} = await import(pathToFileURL(path.join(sdk, 'stdio.js')).href);
    const client = new Client({name: 'desktop-release-smoke', version});
    try {
      await client.connect(new StdioClientTransport({command: node, args: generated.args, env: {...process.env, POKEMON_UI: 'off'}}));
      assert.equal(client.getServerVersion().version, version);
      assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['desktop', 'computer', 'pokemon', 'windows', ...(platform === 'win32' ? ['course', 'excel'] : [])]);
      const result = await client.callTool({name: 'pokemon', arguments: {action: 'status'}});
      assert(!result.isError, 'The packaged MCP server failed its status check');
      for (const pet of ['hello-kitty', 'kuromi']) {
        const selected = await client.callTool({name: 'pokemon', arguments: {action: 'select', pet}});
        assert(!selected.isError);
        assert.equal(selected.structuredContent.pet, pet);
      }
    } finally {
      await client.close();
    }
    console.log(`PASS: actual ${platform}/${process.arch} ZIP relocated, native launcher and Electron started and exited, bundled Node verified, MCP tools connected, portable configuration generated, no developer data included.`);
    passed = true;
  } finally {
    if (passed) {
      assert.equal(path.dirname(fs.realpathSync(scratch)), fs.realpathSync(release));
      assert(path.basename(scratch).startsWith('.desktop-verify-'));
      fs.rmSync(scratch, {recursive: true, force: true});
    } else {
      console.error(`Kept failed package diagnostics at ${scratch}`);
    }
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
