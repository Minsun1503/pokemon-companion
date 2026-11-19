const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {execFileSync, spawn} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const zip = path.resolve(process.argv[2] || path.join(root, 'release/telegram-deepseek', `pokemon-telegram-deepseek-${version}-windows-x64.zip`));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const quote = value => "'" + value.replace(/'/g, "''") + "'";

async function verifyGateway(node, launcher, env, cwd) {
  // Without a bot token the gateway must stop with a setup hint instead of polling.
  const child = spawn(node, [launcher, 'gateway'], {env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  child.stdout.on('data', data => {output += String(data);});
  child.stderr.on('data', data => {output += String(data);});
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {child.kill(); reject(Error('Packaged gateway did not stop without a token.'));}, 60000);
    child.once('exit', value => {clearTimeout(timer); resolve(value);});
  });
  assert.notEqual(code, 0);
  assert(output.includes('agent -- setup'), output);
}

async function main() {
  assert.equal(process.platform, 'win32');
  assert.equal(fs.readFileSync(zip + '.sha256', 'utf8'), `${digest(zip)}  ${path.basename(zip)}\n`);
  // Legacy Windows ZIP APIs have a path limit; test a normal short install root.
  const scratch = fs.mkdtempSync(path.join(path.parse(zip).root, 'pt-'));
  console.log('Extracting and starting the shipped runtime from a new location...');
  const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory(${quote(zip)}, ${quote(scratch)})`;
  execFileSync(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {env: {...process.env, PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules')}, windowsHide: true});
  const extracted = path.join(scratch, path.basename(zip, '.zip'));
  const info = JSON.parse(fs.readFileSync(path.join(extracted, 'build-info.json')));
  for (const [file, expected] of Object.entries(info.files)) assert.equal(digest(path.join(extracted, file)), expected, file);
  assert.equal(JSON.parse(fs.readFileSync(path.join(extracted, 'agent-profile.json'))).id, 'deepseek-telegram');
  for (const file of ['AGENTS.md', 'START-HERE.md', 'AGENT-SETUP.md', 'GROUP-WELCOME.vi.md', 'Start Pokemon Agent.cmd', 'Enable Pokemon Agent Autostart.cmd']) assert(fs.existsSync(path.join(extracted, file)), file);
  for (const forbidden of ['store', 'config.json', '.env', 'agent.stdout.log', 'events.enc', 'browser']) assert(!fs.existsSync(path.join(extracted, forbidden)), forbidden);
  const env = {...process.env, PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules'), POKEMON_HARNESS_HOME: path.join(scratch, 'isolated-data'), };
  for (const key of Object.keys(env)) if (/API_KEY|TELEGRAM_BOT_TOKEN|POKEMON_AGENT_PARENT_PID/.test(key)) delete env[key];
  const node = path.join(extracted, 'runtime/node.exe');
  const launcher = path.join(extracted, 'scripts/harness.cjs');
  const run = (...args) => execFileSync(node, [launcher, ...args], {env, cwd: scratch, encoding: 'utf8', timeout: 90000, windowsHide: true, maxBuffer: 4 * 1024 * 1024});
  assert(run('help').includes('pairing approve'));
  const status = JSON.parse(run('status'));
  const config = JSON.parse(fs.readFileSync(path.join(env.POKEMON_HARNESS_HOME, 'config.json')));
  assert.deepEqual(Object.keys(config.routes), ['deepseek']);
  assert.equal(config.routes.deepseek.baseUrl, 'https://api.deepseek.com');
  assert.equal(config.routes.deepseek.keyEnv, 'DEEPSEEK_API_KEY');
  assert.equal(config.team.auto, false);
  assert.deepEqual(config.fallbacks, []);
  assert.equal(status.modelKey, false);
  assert.equal(status.telegram.token, false);
  assert.equal(status.telegram.pairedUsers, 0);
  assert(run('pairing', 'list').includes('(chưa có)'));
  const checked = JSON.parse(run('check'));
  assert(checked.tools.includes('windows') && checked.tools.includes('browser'));
  const desktop = checked.desktop.structuredContent || JSON.parse(checked.desktop.content.find(item => item.type === 'text').text);
  assert.equal(desktop.native.ready, true);
  await verifyGateway(node, launcher, env, scratch);
  const report = {checkedAt: new Date().toISOString(), outcome: 'passed', zip: path.basename(zip), sha256: digest(zip), relocatedStartup: true, singleDeepSeekRoute: true, cliSetupAndPairingVerified: true, credentialsAbsent: true, nativeReady: true, tools: checked.tools.length, realTelegramVerified: false, paidProviderVerified: false};
  const reportPath = zip + '.verification.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  console.log(`Verification files retained at ${scratch}`);
}
if (require.main === module) {
  main().catch(error => {console.error(error); process.exitCode = 1;});
}
