const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const release = path.join(root, 'release');
const prepared = path.join(release, 'pokemon-companion-win32-x64');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function copy(source, target) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.cpSync(source, target, {recursive: true, dereference: true, filter: file => {
    const base = path.basename(file);
    return base !== '.git' && !base.startsWith('.env') && !base.endsWith('.map');
  }});
}
function json(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build this app on x64 Windows.');
  const currentLock = require('../backend/package-lock.json');
  const preparedLock = JSON.parse(fs.readFileSync(path.join(prepared, 'backend/package-lock.json'), 'utf8'));
  for (const [name, record] of Object.entries(currentLock.packages)) {
    if (!name || record.dev) continue;
    const existing = preparedLock.packages[name];
    if (!existing || existing.version !== record.version || existing.integrity !== record.integrity) throw new Error(`Rebuild the production dependency package first: ${name} changed.`);
  }
  const required = ['backend/dist/standalone.js', 'backend/dist/talk/worker.js', 'backend/dist/windows/uia-worker.dll', 'frontend/build/main/companion/agent.js', 'frontend/node_modules/electron/dist/electron.exe'];
  for (const file of required) if (!fs.existsSync(path.join(root, file))) throw new Error(`Build the app first: ${file} is missing.`);
  const node = path.join(prepared, 'runtime/node.exe');
  const nodeVersion = execFileSync(node, ['--version'], {encoding: 'utf8', windowsHide: true}).trim();
  const checksums = await fetch(`https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`, {signal: AbortSignal.timeout(30000)});
  if (!checksums.ok) throw new Error('Could not verify the bundled Node runtime.');
  const expected = (await checksums.text()).split('\n').find(line => line.endsWith('  win-x64/node.exe'))?.split(/\s+/)[0];
  if (hash(node) !== expected) throw new Error('Bundled Node runtime checksum mismatch.');

  const baseName = 'pokemon-companion-test-win32-x64';
  let name = baseName;
  for (let suffix = 2; fs.existsSync(path.join(release, name)); suffix++) name = `${baseName}-${suffix}`;
  const output = path.join(release, name);
  fs.mkdirSync(output, {recursive: true});
  console.log('Copying the app and its runtimes...');
  copy(path.join(root, 'backend/dist'), path.join(output, 'backend/dist'));
  copy(path.join(prepared, 'backend/node_modules'), path.join(output, 'backend/node_modules'));
  copy(path.join(root, 'backend/package.json'), path.join(output, 'backend/package.json'));
  copy(path.join(prepared, 'runtime'), path.join(output, 'runtime'));
  for (const directory of ['build', 'pets', 'assets']) copy(path.join(root, 'frontend', directory), path.join(output, 'frontend', directory));
  copy(path.join(root, 'frontend/node_modules/electron/dist'), path.join(output, 'frontend/node_modules/electron/dist'));
  json(path.join(output, 'frontend/package.json'), {name: 'pokemon-companion-test', version: require('../package.json').version, main: 'main.js'});
  fs.writeFileSync(path.join(output, 'frontend/main.js'), "require('./build/main/companion/index.js');\n");
  fs.mkdirSync(path.join(output, 'frontend/config'), {recursive: true});
  const settings = JSON.parse(fs.readFileSync(path.join(root, 'frontend/config/setting.json'), 'utf8'));
  const activeSettingsFile = process.env.POKEMON_BUILD_SETTINGS || path.join(process.env.APPDATA, 'pokemon-mcp/setting.json');
  if (fs.existsSync(activeSettingsFile)) {
    const active = JSON.parse(fs.readFileSync(activeSettingsFile, 'utf8'));
    settings.ai.provider = 'ollama';
    settings.ai.ollama = {baseUrl: active.ai.ollama.baseUrl, model: active.ai.ollama.model, options: active.ai.ollama.options};
  }
  json(path.join(output, 'frontend/config/setting.json'), settings);

  for (const file of ['LICENSE', 'THIRD_PARTY.md']) copy(path.join(root, file), path.join(output, file));
  copy(path.join(root, 'frontend/LICENSE'), path.join(output, 'frontend/LICENSE'));
  copy(path.join(root, 'backend/LICENSE'), path.join(output, 'backend/LICENSE'));

  console.log('Building the Windows launcher...');
  const sharp = require(path.join(root, 'frontend/node_modules/sharp'));
  const png = await sharp(path.join(root, 'frontend/assets/icon.png')).resize(256, 256).png().toBuffer();
  const ico = Buffer.alloc(22);
  ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
  ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
  ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(output, 'app.ico'), Buffer.concat([ico, png]));
  const executable = path.join(output, 'Pokemon Companion.exe');
  const compiler = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  execFileSync(compiler, ['/nologo', '/target:winexe', '/platform:x64', '/reference:System.Windows.Forms.dll', `/win32icon:${path.join(output, 'app.ico')}`, `/out:${executable}`, path.join(root, 'packaging/standalone-launcher.cs')], {windowsHide: true, stdio: 'inherit'});

  fs.writeFileSync(path.join(output, 'README.txt'), `Pokemon Companion Test\n\n1. Extract the complete ZIP into a folder if needed.\n2. Double-click Pokemon Companion.exe. Keep the other app folders alongside it.\n3. Click the Pokemon to open its panel. Choose Switch to select a companion or Exit to close the app.\n4. Use the tray menu or Ctrl+Shift+P to pause or resume desktop controls.\n\nTalk is deferred and disabled in this build. Its implementation and existing saved conversations are retained for later.\nSettings and saved conversations remain at %APPDATA%\\pokemon-companion-test. Existing settings are preserved on later launches.\n`);
  const buildInfo = {builtAt: new Date().toISOString(), version: require('../package.json').version, nodeVersion, chatEnabled: false, model: settings.ai.ollama.model, baseUrl: settings.ai.ollama.baseUrl, sourceState: 'current working tree', files: Object.fromEntries(required.filter(file => !file.includes('node_modules')).map(file => [file, hash(path.join(output, file))]))};
  json(path.join(output, 'build-info.json'), buildInfo);
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), `${hash(executable)}  Pokemon Companion.exe\n`);
  console.log(`Ready: ${executable}`);
  console.log('Creating the portable ZIP...');
  // .NET ZIP handles files larger than PowerShell Compress-Archive permits.
  const quote = value => "'" + value.replace(/'/g, "''") + "'";
  const zip = output + '.zip';
  const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory(${quote(output)}, ${quote(zip)}, [System.IO.Compression.CompressionLevel]::Optimal, $true)`;
  execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {windowsHide: true, stdio: 'inherit'});
  fs.writeFileSync(zip + '.sha256', `${hash(zip)}  ${path.basename(zip)}\n`);
  console.log(`ZIP: ${zip}`);
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
