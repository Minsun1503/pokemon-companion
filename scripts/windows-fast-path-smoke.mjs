import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import {dirname, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {connect} from './client.mjs';

assert.equal(process.platform, 'win32');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(resolve(os.tmpdir(), 'pokemon-fast-path-'));
const title = 'Pokemon Fast Path ' + randomUUID().slice(0, 8);
const executable = resolve(scratch, title + '.exe');
const shortcutFolder = resolve(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs', title);
const shortcut = resolve(shortcutFolder, title + ' Shortcut.lnk');
const powershell = resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
let session, fixturePid, browserServer;
let verified = false;
const pageTitle = 'Pokemon URL ' + randomUUID().slice(0, 8);
const api = async (args) => JSON.parse((await session.call('windows', args)).content.find((item) => item.type === 'text').text);
async function stopFixture() {
  if (!fixturePid) {
    try {fixturePid = Number(await readFile(executable.replace(/\.exe$/, '.pid'), 'utf8'));} catch {}
  }
  if (fixturePid) {
    try {process.kill(fixturePid);} catch (error) {if (error.code !== 'ESRCH') throw error;}
    fixturePid = undefined;
    const deadline = performance.now() + 3000;
    while ((await api({action: 'get_windows', query: title})).windows.length) {
      assert(performance.now() < deadline, 'Owned fixture window did not close.');
      await delay(100);
    }
    await rm(executable.replace(/\.exe$/, '.pid'), {force: true});
  }
}
try {
  await mkdir(shortcutFolder);
  const compile = resolve(scratch, 'compile.ps1');
  await writeFile(compile, `param($source, $executable, $shortcut)
$ErrorActionPreference = 'Stop'
Add-Type -Path $source -ReferencedAssemblies System.Windows.Forms,System.Drawing -OutputAssembly $executable -OutputType WindowsApplication
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = $executable
$link.Arguments = 'must-not-be-passed'
$link.Save()
$blocked = $shell.CreateShortcut($shortcut.Replace(' Shortcut.lnk', ' Shell.lnk'))
$blocked.TargetPath = Join-Path $env:SystemRoot 'System32/cmd.exe'
$blocked.Save()
`);
  execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', compile, resolve(root, 'scripts/windows-fast-path-fixture.cs'), executable, shortcut], {windowsHide: true});
  session = await connect({env: {...process.env, PATH: scratch + ';' + process.env.PATH}});
  await session.call('pokemon', {action: 'task', message: 'Checking Windows launch and waits'});
  const measurements = [];
  for (const target of [title + '.exe', executable, title + ' Shortcut']) {
    const start = performance.now();
    const launched = await api({action: 'launch', text: target});
    measurements.push({target: target === executable ? 'full path' : target.endsWith('.exe') ? 'PATH' : 'Start Menu', ms: performance.now() - start});
    assert.equal((await realpath(launched.started)).toLowerCase(), (await realpath(executable)).toLowerCase());
    assert.equal(launched.windows.length, 1);
    fixturePid = Number(await readFile(executable.replace(/\.exe$/, '.pid'), 'utf8'));
    assert.equal(await readFile(executable.replace(/\.exe$/, '.args'), 'utf8'), '0', 'Shortcut arguments must not be used.');
    const window_id = launched.windows[0].id;
    const boundary = await api({action: 'get_ui', window_id, query: 'Reveal control', control_type: 'Button', max_depth: 1});
    assert.equal(boundary.nodes.length, 1, 'Direct native children at the max_depth boundary must remain visible.');
    const value = await api({action: 'wait_for', window_id, query: 'Wait value', control_type: 'Edit', expect_value: 'old'});
    assert.equal(value.nodes[0].value, 'old');
    if (target === executable) {
      const reads = [], waits = [];
      for (let run = 0; run < 20; run += 1) {
        let start = performance.now();
        const current = await api({action: 'get_ui', window_id, query: 'Wait value', control_type: 'Edit'});
        reads.push(performance.now() - start);
        assert.equal(current.nodes[0].value, 'old');
        start = performance.now();
        const ready = await api({action: 'wait_for', window_id, query: 'Wait value', control_type: 'Edit', expect_value: 'old'});
        waits.push(performance.now() - start);
        assert.equal(ready.nodes[0].value, 'old');
      }
      measurements.push({target: 'get_ui satisfied (20 samples)', samples_ms: reads});
      measurements.push({target: 'wait_for satisfied (20 samples)', samples_ms: waits});
    }
    const reveal = await api({action: 'get_ui', window_id, query: 'Reveal control', control_type: 'Button'});
    const waiting = performance.now();
    const batch = await api({action: 'batch', steps: [
      {action: 'invoke', snapshot: reveal.snapshot, element_id: reveal.nodes[0].id},
      {action: 'wait_for', window_id, query: 'Delayed control', control_type: 'Button', timeout_ms: 3000},
      {action: 'wait_for', window_step: 1, query: 'Wait value', control_type: 'Edit', expect_value: 'ready'},
      {action: 'invoke', target_step: 1},
    ]});
    assert.equal(batch.ok, true);
    assert(performance.now() - waiting >= 250, 'wait_for must wait for the delayed control.');
    const timeoutStart = performance.now();
    await assert.rejects(api({action: 'wait_for', window_id, query: 'Never appears', timeout_ms: 250}), /wait_for timed out after 250 ms/);
    assert(performance.now() - timeoutStart < 1500, 'Native reads must not fall back to a 20-second timeout.');
    await stopFixture();
  }
  for (const text of ['cmd.exe /c echo unsafe', 'test.cmd', 'file:///C:/test.exe', title + ' Shell', ...['cmd', 'powershell', 'pwsh', 'wscript', 'cscript', 'mshta'].flatMap(name => [name, name + '.exe', resolve(process.env.SystemRoot, 'System32', name + '.exe')])]) {
    await assert.rejects(api({action: 'launch', text, query: title}));
  }
  browserServer = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>' + pageTitle + '</title><p>Disposable launch verification.</p>');
  });
  await new Promise((ready) => browserServer.listen(0, '127.0.0.1', ready));
  const url = 'http://127.0.0.1:' + browserServer.address().port + '/';
  const started = performance.now();
  const browser = await api({action: 'batch', steps: [
    {action: 'launch', text: url, query: pageTitle, timeout_ms: 15000},
    {action: 'get_windows', query: pageTitle},
  ]});
  measurements.push({target: 'URL', ms: performance.now() - started});
  assert.equal(browser.ok, true);
  assert.equal(browser.result.windows.length, 1);
  assert(browser.result.windows[0].title.includes(pageTitle));
  const distribution = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {median: (sorted[9] + sorted[10]) / 2, p95: sorted[18]};
  };
  console.table(measurements.map(({target, ms, samples_ms}) => ({target, ...(samples_ms ? distribution(samples_ms) : {ms})})));
  if (process.argv[2]) await writeFile(resolve(root, process.argv[2]), JSON.stringify({complete: true, measured_at: new Date().toISOString(), measurements}, null, 2) + '\n');
  console.log('PASS: PATH, full-path and Start Menu launches; ignored shortcut arguments; delayed controls and exact values; batch references; bounded timeout; shell target rejection; default-browser URL verified through Windows UI Automation.');
  verified = true;
} finally {
  if (session) {
    await stopFixture();
    // Close only the unique page this check opened, after a fresh activation/title check.
    const tabs = await api({action: 'get_windows', query: pageTitle});
    if (tabs.windows.length === 1) {
      const document = await api({action: 'get_ui', window_id: tabs.windows[0].id, query: pageTitle, control_type: 'Document'});
      assert.equal(document.nodes.length, 1);
      await api({action: 'focus', snapshot: document.snapshot, element_id: document.nodes[0].id});
      const active = await api({action: 'get_windows', query: pageTitle});
      assert(active.windows[0]?.active && active.windows[0]?.title.includes(pageTitle));
      await session.call('computer', {action: 'key', text: 'ctrl+w'});
      let closed = await api({action: 'get_windows', query: pageTitle});
      if (closed.windows.length) closed = await api({action: 'get_windows', query: pageTitle});
      assert.equal(closed.windows.length, 0, 'Owned browser page did not close.');
    }
    if (verified) await session.call('pokemon', {action: 'done', message: 'Native Windows launches and waits verified'});
    await session.client.close();
  }
  if (browserServer) await new Promise((closed) => {browserServer.close(closed); browserServer.closeAllConnections();});
  assert.equal(dirname(scratch), resolve(os.tmpdir()));
  assert.equal(dirname(shortcutFolder), resolve(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs'));
  await rm(shortcutFolder, {recursive: true, force: true});
  await rm(scratch, {recursive: true, force: true});
}
