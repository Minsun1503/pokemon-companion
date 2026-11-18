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

async function verifySetup(extracted, node, launcher, env, cwd) {
  const child = spawn(node, [launcher, 'run'], {env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  let browser;
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Packaged setup startup timed out.')), 30000);
      child.once('exit', () => {clearTimeout(timer); reject(Error('Packaged setup exited before readiness.'));});
      child.stdout.on('data', data => {
        output += String(data);
        const match = /POKEMON_AGENT_READY (http:\/\/127\.0\.0\.1:\d+)\/#([a-f0-9]+)/.exec(output);
        if (match) {clearTimeout(timer); resolve({url: match[1], token: match[2]});}
      });
      child.stderr.resume();
    });
    const playwright = require(path.join(extracted, 'backend/node_modules/playwright'));
    const cache = path.join(extracted, 'backend/node_modules/playwright-core/.local-browsers');
    const manifest = JSON.parse(fs.readFileSync(path.join(cache, 'pokemon-browser.json')));
    browser = await playwright.chromium.launch({headless: true, executablePath: path.join(cache, manifest.executable)});
    const page = await browser.newPage();
    await page.goto(`${ready.url}/#${ready.token}`);
    await page.waitForFunction(() => document.querySelector('h1').textContent.includes('DeepSeek'));
    assert.equal(await page.locator('#route option').count(), 1);
    assert.equal(await page.locator('#route').inputValue(), 'deepseek');
    assert.equal(await page.locator('#baseUrl').isDisabled(), true);
    assert.equal(await page.locator('#newRoute').isVisible(), false);
    assert.equal(await page.locator('#transport').isVisible(), false);
    assert.equal(await page.locator('#relayEnabled').isVisible(), false);
    assert.equal(await page.locator('#key').inputValue(), '');
    assert.equal(await page.locator('#botToken').inputValue(), '');
    const status = await (await fetch(ready.url + '/api/status', {headers: {Authorization: 'Bearer ' + ready.token}})).json();
    assert.equal(status.deepSeekOnly, true);
    assert.deepEqual(Object.keys(status.config.routes), ['deepseek']);
  } finally {
    await browser?.close();
    const stopped = new Promise(resolve => {child.once('exit', resolve);});
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([stopped, new Promise((_, reject) => {const timer = setTimeout(() => reject(Error('Packaged gateway did not stop.')), 20000);timer.unref();})]);
    }
  }
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
  const env = {...process.env, PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules'), POKEMON_HARNESS_HOME: path.join(scratch, 'isolated-data'), POKEMON_HARNESS_PORT: '0', POKEMON_AGENT_NO_OPEN: '1'};
  for (const key of Object.keys(env)) if (/API_KEY|TELEGRAM_BOT_TOKEN|POKEMON_AGENT_PARENT_PID/.test(key)) delete env[key];
  const node = path.join(extracted, 'runtime/node.exe');
  const launcher = path.join(extracted, 'scripts/harness.cjs');
  const run = mode => execFileSync(node, [launcher, mode], {env, cwd: scratch, encoding: 'utf8', timeout: 90000, windowsHide: true, maxBuffer: 4 * 1024 * 1024});
  run('init');
  const config = JSON.parse(fs.readFileSync(path.join(env.POKEMON_HARNESS_HOME, 'config.json')));
  assert.deepEqual(Object.keys(config.routes), ['deepseek']);
  assert.equal(config.routes.deepseek.baseUrl, 'https://api.deepseek.com');
  assert.equal(config.routes.deepseek.keyEnv, 'DEEPSEEK_API_KEY');
  assert.equal(config.team.auto, true);
  assert.deepEqual(config.fallbacks, []);
  assert.equal(config.desktopRelay.enabled, false);
  const status = JSON.parse(run('status'));
  assert.equal(status.routes.length, 1);
  assert.equal(status.routes[0].keyConfigured, false);
  assert.equal(status.telegram.tokenConfigured, false);
  const checked = JSON.parse(run('check'));
  assert(checked.tools.includes('windows') && checked.tools.includes('browser'));
  const desktop = checked.desktop.structuredContent || JSON.parse(checked.desktop.content.find(item => item.type === 'text').text);
  assert.equal(desktop.native.ready, true);
  await verifySetup(extracted, node, launcher, env, scratch);
  const report = {checkedAt: new Date().toISOString(), outcome: 'passed', zip: path.basename(zip), sha256: digest(zip), relocatedStartup: true, singleDeepSeekRoute: true, setupUiVerified: true, credentialsAbsent: true, nativeReady: true, tools: checked.tools.length, realTelegramVerified: false, paidProviderVerified: false};
  const reportPath = zip + '.verification.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  console.log(`Verification files retained at ${scratch}`);
}
if (require.main === module) {
  main().catch(error => {console.error(error); process.exitCode = 1;});
}
