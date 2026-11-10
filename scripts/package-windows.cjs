const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const npmCli = process.env.npm_execpath;
const release = path.join(root, 'release');
const name = 'pokemon-companion-win32-x64';
const output = path.join(release, name);

function json(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.cpSync(source, destination, {recursive: true, dereference: true, filter: (file) => {
    const base = path.basename(file);
    return base !== '.git' && base !== '.env' && !base.startsWith('.env.') && !base.endsWith('.map');
  }});
}
function run(args, cwd) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {cwd, stdio: 'inherit', windowsHide: true});
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed.`);
}
async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build this package on x64 Windows.');
  if (!npmCli) throw new Error('Run npm run package:windows.');
  if (fs.existsSync(output)) throw new Error(`Package directory already exists: ${output}. Move it aside before rebuilding.`);
  fs.mkdirSync(release, {recursive: true});
  const stage = fs.mkdtempSync(path.join(release, '.package-'));
  console.log(`Preparing self-contained Windows package at ${stage}`);
  for (const file of ['package.json', 'package-lock.json', 'LICENSE']) copy(path.join(root, 'backend', file), path.join(stage, 'backend', file));
  // Imported component versions describe upstream provenance, not this app release.
  const backendManifest = JSON.parse(fs.readFileSync(path.join(stage, 'backend/package.json'), 'utf8'));
  json(path.join(stage, 'backend/package.json'), {...backendManifest, version});
  const backendLock = JSON.parse(fs.readFileSync(path.join(stage, 'backend/package-lock.json'), 'utf8'));
  backendLock.version = version;
  backendLock.packages[''].version = version;
  json(path.join(stage, 'backend/package-lock.json'), backendLock);
  copy(path.join(root, 'backend/dist'), path.join(stage, 'backend/dist'));
  run(['ci', '--omit=dev', '--no-audit', '--no-fund'], path.join(stage, 'backend'));
  for (const directory of ['build', 'pets', 'assets']) copy(path.join(root, 'frontend', directory), path.join(stage, 'frontend', directory));
  copy(path.join(root, 'frontend/config/setting.json'), path.join(stage, 'frontend/config/setting.json'));
  copy(path.join(root, 'frontend/LICENSE'), path.join(stage, 'frontend/LICENSE'));
  copy(path.join(root, 'frontend/node_modules/electron/dist'), path.join(stage, 'frontend/node_modules/electron/dist'));
  json(path.join(stage, 'frontend/package.json'), {name: 'pokemon-companion-ui', version, main: 'main.js'});
  fs.writeFileSync(path.join(stage, 'frontend/main.js'), "require('./build/main/companion/index.js');\n");
  copy(path.join(root, 'frontend/assets/icon.png'), path.join(stage, 'icon.png'));
  // Use a verified upstream Node distribution, not the developer's local executable.
  const nodeVersion = 'v24.16.0';
  const nodePath = `win-x64/node.exe`;
  const nodeBase = `https://nodejs.org/dist/${nodeVersion}/`;
  const sumsResponse = await fetch(nodeBase + 'SHASUMS256.txt');
  if (!sumsResponse.ok) throw new Error('Could not read Node release checksums.');
  const expected = (await sumsResponse.text()).split('\n').find((line) => line.endsWith('  ' + nodePath))?.split(/\s+/)[0];
  if (!expected) throw new Error('Node checksum missing.');
  const binaryResponse = await fetch(nodeBase + nodePath);
  if (!binaryResponse.ok) throw new Error('Could not download Node runtime.');
  const binary = Buffer.from(await binaryResponse.arrayBuffer());
  if (crypto.createHash('sha256').update(binary).digest('hex') !== expected) throw new Error('Node runtime checksum mismatch.');
  fs.mkdirSync(path.join(stage, 'runtime'), {recursive: true});
  fs.writeFileSync(path.join(stage, 'runtime/node.exe'), binary);
  const license = await fetch(`https://raw.githubusercontent.com/nodejs/node/${nodeVersion}/LICENSE`);
  if (!license.ok) throw new Error('Could not download Node license.');
  fs.writeFileSync(path.join(stage, 'runtime/LICENSE'), await license.text());
  const manifest = require('../packaging/manifest.json');
  json(path.join(stage, 'manifest.json'), {...manifest, version});
  const basePlugin = {name: 'pokemon-companion', version, description: manifest.description, author: manifest.author};
  const server = (variable) => ({command: `${variable}/runtime/node.exe`, args: [`${variable}/backend/dist/main.js`], env: {MCP_TRANSPORT: 'stdio', POKEMON_FRONTEND_DIR: `${variable}/frontend`}});
  json(path.join(stage, '.claude-plugin/plugin.json'), {...basePlugin, mcpServers: {'pokemon-companion': server('${CLAUDE_PLUGIN_ROOT}')}});
  json(path.join(stage, 'plugin.json'), {$schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', ...basePlugin, license: 'MIT'});
  json(path.join(stage, '.codex-plugin/plugin.json'), {...basePlugin, interface: {displayName: 'Pokémon Companion', shortDescription: 'Seven Pokémon for Windows computer control', developerName: manifest.author.name, category: 'Productivity', capabilities: ['Read', 'Write'], logo: './icon.png'}});
  json(path.join(stage, 'mcp.json'), {$schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: {'pokemon-companion': {...server('${PLUGIN_ROOT}'), type: 'stdio', command: './runtime/node.exe'}}});
  const claudeMarketplace = require('../.claude-plugin/marketplace.json');
  json(path.join(stage, '.claude-plugin/marketplace.json'), {...claudeMarketplace, plugins: claudeMarketplace.plugins.map((plugin) => ({...plugin, source: './'}))});
  const codexMarketplace = require('../.agents/plugins/marketplace.json');
  json(path.join(stage, '.agents/plugins/marketplace.json'), {...codexMarketplace, plugins: codexMarketplace.plugins.map((plugin) => ({...plugin, source: {source: 'local', path: './'}}))});
  copy(path.join(root, 'packaging/install-client.ps1'), path.join(stage, 'install-client.ps1'));
  for (const [client, label] of [['Codex', 'Codex'], ['ClaudeCode', 'Claude Code']]) {
    fs.writeFileSync(path.join(stage, `Install ${label}.cmd`), `@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-client.ps1" -Client ${client}\r\npause\r\n`);
  }
  copy(path.join(root, 'INSTALL.md'), path.join(stage, 'README.md'));
  fs.writeFileSync(path.join(stage, 'AGENT_GUIDE.md'), `Package version: ${version}\nResponse contract version: 1\n\n` + fs.readFileSync(path.join(root, 'packaging/agent-guide.md'), 'utf8'));
  for (const file of ['THIRD_PARTY.md', 'LICENSE']) copy(path.join(root, file), path.join(stage, file));
  fs.writeFileSync(path.join(stage, 'NOTICE.txt'), 'Unofficial Pokémon fan project. Assets belong to Nintendo / Creatures Inc. / GAME FREAK. Original frontend and backend MIT licenses are included in their folders. Electron and Node licenses are included with their runtimes. Dependencies retain their own licenses.\n');
  fs.renameSync(stage, output);
  run(['exec', '--yes', '--package=@anthropic-ai/mcpb@2.1.2', '--', 'mcpb', 'validate', path.join(output, 'manifest.json')], root);
  run(['exec', '--yes', '--package=@anthropic-ai/mcpb@2.1.2', '--', 'mcpb', 'pack', output, path.join(release, name + '.mcpb')], root);
  // MCPB is a ZIP archive; the portable plugin installers use the same contents.
  fs.copyFileSync(path.join(release, name + '.mcpb'), path.join(release, name + '.zip'));
  const hashes = ['mcpb', 'zip'].map((extension) => {
    const file = `${name}.${extension}`;
    return `${crypto.createHash('sha256').update(fs.readFileSync(path.join(release, file))).digest('hex')}  ${file}`;
  });
  fs.writeFileSync(path.join(release, 'SHA256SUMS.txt'), hashes.join('\n') + '\n');
  console.log(`Ready: release/${name}.mcpb (Claude Desktop), .zip (Claude Code / Codex).`);
}
main().catch((error) => {console.error(error.message); process.exitCode = 1;});
