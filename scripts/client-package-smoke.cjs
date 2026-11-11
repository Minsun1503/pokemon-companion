const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');
const release = path.join(root, 'release');
const version = require('../package.json').version;
const platform = process.platform;
const label = {win32: 'windows', darwin: 'macos', linux: 'linux'}[platform];
const pluginZip = path.join(release, `pokemon-companion-${version}-plugin-${label}-${process.arch}.zip`);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function main() {
  assert.equal(fs.readFileSync(pluginZip + '.sha256', 'utf8'), `${hash(pluginZip)}  ${path.basename(pluginZip)}\n`);
  const scratch = fs.mkdtempSync(path.join(release, '.client-verify-'));
  let passed = false;
  try {
    if (platform === 'linux') {
      execFileSync('unzip', ['-q', pluginZip, '-d', scratch]);
    } else {
      const mcpb = path.join(release, `pokemon-companion-${version}-claude-${label}-${process.arch}.mcpb`);
      assert.equal(hash(mcpb), hash(pluginZip));
      assert.equal(fs.readFileSync(mcpb + '.sha256', 'utf8'), `${hash(mcpb)}  ${path.basename(mcpb)}\n`);
      // Exercise Anthropic's actual bundle unpacker, rather than only a generic ZIP extractor.
      execFileSync(process.execPath, [process.env.npm_execpath, 'exec', '--yes', '--package=@anthropic-ai/mcpb@2.1.2', '--', 'mcpb', 'unpack', mcpb, scratch], {cwd: root, stdio: 'inherit', windowsHide: true});
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, 'manifest.json')));
    const plugin = JSON.parse(fs.readFileSync(path.join(scratch, 'plugin.json')));
    const openai = JSON.parse(fs.readFileSync(path.join(scratch, 'mcp.json'))).mcpServers['pokemon-companion'];
    assert.equal(manifest.version, version);
    assert.deepEqual(manifest.compatibility.platforms, [platform]);
    assert.equal(manifest.server.type, 'binary');
    assert.equal(plugin.version, version);
    assert.equal(plugin.extensions['com.openai'].requires_local_executor, true);
    assert.equal(openai.type, 'stdio');
    assert(!manifest.user_config, 'The extension unexpectedly requires user configuration');
    const resolve = (value, variable) => value.replaceAll(variable, scratch);
    const config = manifest.server.mcp_config;
    const command = resolve(config.command, '${__dirname}');
    const args = config.args.map(arg => resolve(arg, '${__dirname}'));
    assert.equal(resolve(openai.command, '${PLUGIN_ROOT}'), command);
    assert.deepEqual(openai.args.map(arg => resolve(arg, '${PLUGIN_ROOT}')), args);
    assert.equal(resolve(openai.cwd, '${PLUGIN_ROOT}'), scratch);
    const env = Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, resolve(value, '${__dirname}') ]));
    const appRoot = path.dirname(path.dirname(command));
    assert.equal(execFileSync(command, ['--version'], {encoding: 'utf8', windowsHide: true}).trim(), 'v24.16.0');
    if (platform !== 'win32') {
      assert.equal(fs.realpathSync(env.POKEMON_AGENT_DESKTOP), fs.realpathSync(path.join(appRoot, 'runtime/agent-desktop/agent-desktop')));
      const native = JSON.parse(execFileSync(env.POKEMON_AGENT_DESKTOP, ['version'], {encoding: 'utf8'}));
      assert.equal(native.version, '2.6');
      assert.equal(native.ok, true);
    }
    const scan = directory => {
      for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        assert(!entry.name.startsWith('.env') && entry.name !== '.git' && entry.name !== 'companion_chats.json', `Private data included: ${entry.name}`);
        if (entry.isDirectory()) scan(path.join(directory, entry.name));
        else if (entry.isSymbolicLink()) {
          const target = fs.readlinkSync(path.join(directory, entry.name));
          assert(!path.isAbsolute(target), 'Package contains a nonportable absolute symlink');
          assert(fs.existsSync(path.join(directory, entry.name)), `Package has a broken symlink: ${entry.name}`);
        }
      }
    };
    scan(scratch);
    const sdk = path.join(appRoot, 'backend/node_modules/@modelcontextprotocol/sdk/dist/esm/client');
    const {Client} = await import(pathToFileURL(path.join(sdk, 'index.js')).href);
    const {StdioClientTransport} = await import(pathToFileURL(path.join(sdk, 'stdio.js')).href);
    const client = new Client({name: 'native-client-package-check', version});
    const profile = path.join(scratch, '.test-profile');
    const launchEnv = {...process.env, ...env, POKEMON_USER_DATA_DIR: profile,
      PATH: platform === 'win32' ? `${process.env.SystemRoot}/System32;${process.env.SystemRoot}` : '/usr/bin:/bin:/usr/sbin:/sbin'};
    delete launchEnv.POKEMON_UI;
    delete launchEnv.ELECTRON_RUN_AS_NODE;
    try {
      await client.connect(new StdioClientTransport({command, args, cwd: scratch, env: launchEnv}));
      assert.equal(client.getServerVersion().version, version);
      const tools = (await client.listTools()).tools.map(tool => tool.name);
      assert.deepEqual(tools, manifest.tools.map(tool => tool.name));
      const selected = await client.callTool({name: 'pokemon', arguments: {action: 'select', pet: 'pikachu'}});
      assert(!selected.isError, JSON.stringify(selected.content));
      for (const pet of ['hello-kitty', 'kuromi']) {
        const result = await client.callTool({name: 'pokemon', arguments: {action: 'select', pet}});
        assert(!result.isError, JSON.stringify(result.content));
        assert.equal(result.structuredContent.pet, pet);
        assert.deepEqual(fs.readFileSync(path.join(appRoot, 'frontend/pets', pet, 'sprites.json')), fs.readFileSync(path.join(root, 'frontend/pets', pet, 'sprites.json')));
      }
      assert(fs.existsSync(profile), 'The manifest launch did not open the actual companion');
      const result = await client.callTool({name: 'pokemon', arguments: {action: 'status'}});
      assert(!result.isError);
      if (platform === 'win32') {
        const status = await client.callTool({name: 'desktop', arguments: {action: 'status'}});
        assert(!status.isError);
        assert.equal(status.structuredContent.native.ready, true, 'Bundled Windows worker is unavailable with system-only PATH');
        const windows = await client.callTool({name: 'windows', arguments: {steps: [{action: 'get_windows'}], max_chars: 2000}});
        assert(!windows.isError, JSON.stringify(windows.content));
        assert.equal(JSON.parse(windows.content.find(item => item.type === 'text').text).completed, 1);
        const cursor = await client.callTool({name: 'computer', arguments: {action: 'get_cursor_position'}});
        assert(!cursor.isError, JSON.stringify(cursor.content));
      }
    } finally {
      await client.close();
    }
    console.log(`PASS: ${platform}/${process.arch} client-native bundle unpacked and launched directly from its shipped Claude/ChatGPT configurations with only system PATH, no manual config, and its real companion. Native dependencies and portable symlinks verified.`);
    passed = true;
  } finally {
    if (passed) {
      assert.equal(path.dirname(fs.realpathSync(scratch)), fs.realpathSync(release));
      assert(path.basename(scratch).startsWith('.client-verify-'));
      fs.rmSync(scratch, {recursive: true, force: true});
    } else console.error(`Kept failed client-package diagnostics at ${scratch}`);
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
