const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {addAgentLauncher} = require('./package-agent.cjs');
const {ensureBrowser} = require('./ensure-browser.cjs');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const release = process.env.POKEMON_RELEASE_DIR ? path.resolve(process.env.POKEMON_RELEASE_DIR) : path.join(root, 'release', 'telegram-deepseek');
const name = `pokemon-telegram-deepseek-${version}-windows-x64`;
const output = path.join(release, name);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.cpSync(source, destination, {recursive: true, dereference: true, filter: file => {
    const base = path.basename(file);
    return base !== '.git' && !base.startsWith('.env') && !base.endsWith('.map');
  }});
}
async function download(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(120000)});
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build on Windows x64.');
  if (!process.env.npm_execpath) throw new Error('Run npm run package:telegram.');
  if (fs.existsSync(output) || fs.existsSync(output + '.zip')) throw new Error('Output exists. Select a fresh POKEMON_RELEASE_DIR; do not overwrite a previous release.');
  for (const file of ['backend/dist/harness/main.js', 'backend/dist/windows/uia-worker.dll', 'frontend/build/main/companion/index.js', 'frontend/node_modules/electron/dist/electron.exe']) {
    if (!fs.existsSync(path.join(root, file))) throw new Error(`Build first: ${file}`);
  }
  fs.mkdirSync(release, {recursive: true});
  const stage = fs.mkdtempSync(path.join(release, '.telegram-stage-'));
  console.log('Preparing Telegram portable with fresh production dependencies...');
  for (const file of ['package.json', 'package-lock.json', 'LICENSE']) copy(path.join(root, 'backend', file), path.join(stage, 'backend', file));
  copy(path.join(root, 'backend/dist'), path.join(stage, 'backend/dist'));
  for (const file of ['record-desktop.py', 'prepare-recording-certificate.py']) copy(path.join(root, 'scripts', file), path.join(stage, 'scripts', file));
  execFileSync(process.execPath, [process.env.npm_execpath, 'ci', '--omit=dev', '--no-audit', '--no-fund'], {cwd: path.join(stage, 'backend'), stdio: 'inherit', windowsHide: true});
  ensureBrowser(path.join(stage, 'backend'), path.join(root, 'backend'));
  for (const directory of ['build', 'pets', 'assets']) copy(path.join(root, 'frontend', directory), path.join(stage, 'frontend', directory));
  for (const file of ['package.json', 'package-lock.json']) copy(path.join(root, 'frontend', file), path.join(stage, 'frontend', file));
  execFileSync(process.execPath, [process.env.npm_execpath, 'ci', '--omit=dev', '--no-audit', '--no-fund'], {cwd: path.join(stage, 'frontend'), stdio: 'inherit', windowsHide: true});
  copy(path.join(root, 'frontend/node_modules/electron/dist'), path.join(stage, 'frontend/node_modules/electron/dist'));
  copy(path.join(root, 'frontend/config/setting.json'), path.join(stage, 'frontend/config/setting.json'));
  copy(path.join(root, 'frontend/LICENSE'), path.join(stage, 'frontend/LICENSE'));
  json(path.join(stage, 'frontend/package.json'), {name: 'pokemon-telegram-ui', version, main: 'main.js', dependencies: require('../frontend/package.json').dependencies});
  fs.writeFileSync(path.join(stage, 'frontend/main.js'), "require('./build/main/companion/index.js');\n");
  fs.mkdirSync(path.join(stage, 'runtime'));
  const nodeVersion = 'v24.16.0';
  let nodeVerification = 'upstream SHA256SUMS';
  if (process.env.POKEMON_NODE_RUNTIME_DIR) {
    const cached = path.resolve(process.env.POKEMON_NODE_RUNTIME_DIR);
    const executable = path.join(cached, 'node.exe');
    const quote = value => "'" + value.replace(/'/g, "''") + "'";
    const script = `$signature = Get-AuthenticodeSignature -FilePath ${quote(executable)}; @{status=[string]$signature.Status; signer=$signature.SignerCertificate.Subject} | ConvertTo-Json -Compress`;
    const signature = JSON.parse(execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {env: {...process.env, PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules')}, encoding: 'utf8', windowsHide: true}));
    if (signature.status !== 'Valid' || !/^CN=OpenJS Foundation,/.test(signature.signer)) throw new Error('Cached Node runtime lacks a valid OpenJS Foundation signature.');
    if (execFileSync(executable, ['--version'], {encoding: 'utf8', windowsHide: true}).trim() !== nodeVersion) throw new Error('Cached Node runtime version mismatch.');
    copy(executable, path.join(stage, 'runtime/node.exe'));
    copy(path.join(cached, 'LICENSE'), path.join(stage, 'runtime/LICENSE'));
    nodeVerification = 'valid Windows Authenticode OpenJS Foundation signature and pinned version';
  } else {
    const nodeBase = `https://nodejs.org/dist/${nodeVersion}/`;
    const sums = (await download(nodeBase + 'SHASUMS256.txt')).toString('utf8');
    const expected = sums.split('\n').find(line => line.endsWith('  win-x64/node.exe'))?.split(/\s+/)[0];
    const binary = await download(nodeBase + 'win-x64/node.exe');
    if (!expected || crypto.createHash('sha256').update(binary).digest('hex') !== expected) throw new Error('Node checksum mismatch.');
    fs.writeFileSync(path.join(stage, 'runtime/node.exe'), binary);
    fs.writeFileSync(path.join(stage, 'runtime/LICENSE'), await download(`https://raw.githubusercontent.com/nodejs/node/${nodeVersion}/LICENSE`));
  }
  addAgentLauncher(stage, stage, 'win32', {deepSeekOnly: true});
  for (const file of ['LICENSE', 'THIRD_PARTY.md']) copy(path.join(root, file), path.join(stage, file));
  fs.writeFileSync(path.join(stage, 'README.txt'), 'Pokemon Telegram - DeepSeek only\n\nExtract the complete ZIP. Ask your agent to read AGENT-SETUP.md and confirm your bot name and installation choices before setup. Start with START-HERE.md.\n\nRun Start Pokemon Agent.cmd after confirmation. No Node/npm installation needed. One bot per PC. Group registration, private work and approvals. API keys and bot tokens are entered locally and are never included in this package.\n');
  fs.writeFileSync(path.join(stage, 'NOTICE.txt'), 'Unofficial Pokemon fan project. Assets belong to Nintendo / Creatures Inc. / GAME FREAK. MIT and third-party licenses are included.\n');
  const critical = ['agent-profile.json', 'AGENT-SETUP.md', 'GROUP-WELCOME.vi.md', 'backend/dist/harness/main.js', 'backend/dist/harness/telegram.js', 'backend/dist/harness/config.js', 'backend/dist/windows/uia-worker.dll', 'frontend/package.json', 'frontend/node_modules/express/package.json', 'runtime/node.exe'];
  json(path.join(stage, 'build-info.json'), {builtAt: new Date().toISOString(), version, nodeVersion, nodeVerification, profile: 'deepseek-telegram', modelProvider: 'deepseek', personalDataIncluded: false, sourceState: 'current working tree', files: Object.fromEntries(critical.map(file => [file, hash(path.join(stage, file))]))});
  fs.renameSync(stage, output);
  console.log('Creating portable ZIP...');
  const quote = value => "'" + value.replace(/'/g, "''") + "'";
  const zip = output + '.zip';
  const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory(${quote(output)}, ${quote(zip)}, [System.IO.Compression.CompressionLevel]::Optimal, $true)`;
  execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {env: {...process.env, PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules')}, stdio: 'inherit', windowsHide: true});
  fs.writeFileSync(zip + '.sha256', `${hash(zip)}  ${path.basename(zip)}\n`);
  console.log(`Ready: ${zip}`);
}
if (require.main === module) main().catch(error => {console.error(error.message); process.exitCode = 1;});
