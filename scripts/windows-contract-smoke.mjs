import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {WindowsAutomation} from '../backend/dist/windows/automation.js';

assert.equal(process.platform, 'win32');
const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-contract-'));
const executable = resolve(scratch, 'fixture.exe');
const source = resolve(scratch, 'fixture.cs');
const script = resolve(scratch, 'compile.ps1');
const prefix = 'PC-' + randomUUID().slice(0, 8);
const worker = new WindowsAutomation();
let child;

async function stopFixture() {
  const running = child;
  child = undefined;
  if (!running?.pid || running.exitCode !== null || running.signalCode !== null) return;
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned fixture did not exit.')), 5000);
    running.once('exit', () => {clearTimeout(timer); done();});
    running.kill();
  });
}

try {
  await writeFile(source, `using System;
using System.IO;
using System.Windows.Forms;
class QuietForm : Form {
    protected override bool ShowWithoutActivation { get { return true; } }
}
class Fixture {
    [STAThread] static void Main(string[] args) {
        for (int i = 0; i < Int32.Parse(args[0]); i++) {
            var form = new QuietForm { Text = args[1] + "-" + i, ShowInTaskbar = false, StartPosition = FormStartPosition.Manual, Left = -30000, Top = -30000, Width = 100, Height = 100 };
            form.Show();
        }
        File.WriteAllText(args[2], "ready");
        Application.Run();
    }
}`);
  await writeFile(script, 'param($source, $output)\n$ErrorActionPreference = \'Stop\'\nAdd-Type -Path $source -ReferencedAssemblies System.Windows.Forms,System.Drawing -OutputAssembly $output -OutputType WindowsApplication\n');
  execFileSync(resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', script, source, executable], {windowsHide: true, stdio: 'inherit'});

  for (const count of [100, 101]) {
    const ready = resolve(scratch, 'ready-' + count);
    child = spawn(executable, [String(count), prefix, ready], {windowsHide: true, stdio: 'ignore'});
    let launchError;
    child.once('error', error => {launchError = error;});
    const deadline = performance.now() + 10000;
    for (;;) {
      if (launchError) throw launchError;
      assert(child.exitCode === null, 'Owned fixture exited before it became ready.');
      try {if (await readFile(ready, 'utf8') === 'ready') break;} catch (error) {if (error.code !== 'ENOENT') throw error;}
      assert(performance.now() < deadline, 'Owned fixture did not become ready.');
      await delay(50);
    }
    const result = await worker.request({action: 'get_windows', query: prefix, max_elements: 250, max_chars: 16000});
    assert.equal(result.windows.length, 100);
    assert.equal(result.complete, count === 100);
    assert.equal(result.truncated, count > 100);
    const offscreen = result.windows.at(-1);
    assert.equal(offscreen.minimized, false);
    const ui = await worker.request({action: 'get_ui', window_id: offscreen.id, window_ref: offscreen.window_ref});
    assert.equal(ui.complete, false, 'Offscreen root was reported complete: ' + JSON.stringify(ui));
    assert.equal(ui.truncated, true);
    assert.equal(ui.nodes.length, 0);
    await stopFixture();
  }

  await assert.rejects(worker.request({action: 'invoke', snapshot: '0'.repeat(32), element_id: 1}), error => {
    assert.equal(error.details.code, 'STALE_REF');
    assert.deepEqual(error.details.disposition, {delivery: 'not_delivered', retry: 'safe'});
    assert.equal(error.details.recovery.requires_fresh_snapshot, true);
    return true;
  });
  await assert.rejects(worker.request({action: 'get_ui', window_id: '0'}), error => {
    assert.equal(error.details.code, 'WINDOW_NOT_FOUND');
    assert.equal(error.details.disposition.delivery, 'not_delivered');
    return true;
  });
  console.log('PASS: real native worker reports exact/overflow window coverage, rejects offscreen-root coverage, and preserves pre-action rejection evidence.');
} finally {
  worker.close();
  await stopFixture();
  const verified = await realpath(scratch);
  assert.equal(dirname(verified).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
  assert(verified.split(/[\\/]/).at(-1).startsWith('pokemon-contract-'));
  await rm(verified, {recursive: true, force: true});
}
