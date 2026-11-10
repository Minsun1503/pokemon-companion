import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {WindowsAutomation} from '../backend/dist/windows/automation.js';
import {runWindowsRequest} from '../backend/dist/windows/batch.js';
import {benchmarkIdentity} from './identity-benchmark.mjs';

assert.equal(process.platform, 'win32');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-identity-'));
const worker = new WindowsAutomation();
const children = new Set();
const discoverySizes = [];

async function waitFor(read, accept, message) {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await delay(50);
  }
  throw new Error(message);
}

async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned identity fixture did not exit.')), 5000);
    child.once('exit', () => {clearTimeout(timer); done();});
    child.kill();
  });
  children.delete(child);
}

function launch(command, args, env = process.env) {
  const child = spawn(command, args, {env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  children.add(child);
  let failure;
  child.once('error', error => {failure = error;});
  child.stdout.on('data', () => {});
  return {child, check() {if (failure) throw failure; assert.equal(child.exitCode, null, 'Owned identity fixture exited.');}};
}

async function nativeFixture() {
  const executable = resolve(scratch, 'native.exe');
  const script = resolve(scratch, 'compile.ps1');
  await writeFile(script, "param($source, $output)\n$ErrorActionPreference = 'Stop'\nAdd-Type -Path $source -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions -OutputAssembly $output -OutputType WindowsApplication\n");
  execFileSync(resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', script, resolve(root, 'scripts/identity-fixture.cs'), executable], {windowsHide: true, stdio: 'inherit'});
  const title = 'Identity Native ' + randomUUID().slice(0, 8);
  const running = launch(executable, [scratch, title]);
  const state = async () => {
    running.check();
    try {return JSON.parse(await readFile(resolve(scratch, 'state.json'), 'utf8'));}
    catch (error) {if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}; throw error;}
  };
  await waitFor(state, value => typeof value.clicks === 'number', 'Native identity fixture did not become ready.');
  return {kind: 'WinForms', title, child: running.child, state, async command(command) {
    const before = await waitFor(state, value => typeof value.sequence === 'number', 'Missing native state.');
    await writeFile(resolve(scratch, 'command'), command);
    return waitFor(state, value => value.sequence > before.sequence, 'Native fixture command did not finish.');
  }};
}

async function electronFixture() {
  const title = 'Identity Electron ' + randomUUID().slice(0, 8);
  const env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  const running = launch(resolve(root, 'frontend/node_modules/electron/dist/electron.exe'), [resolve(root, 'scripts/identity-electron-fixture.cjs'), resolve(scratch, 'electron-data'), title, '--force-renderer-accessibility'], env);
  let output = '', port;
  running.child.stdout.on('data', data => {
    output += data;
    for (const line of output.split('\n')) {try {port = JSON.parse(line).port || port;} catch {}}
  });
  await waitFor(async () => {running.check(); return port;}, value => typeof value === 'number', 'Electron identity fixture did not become ready.');
  const command = async command => {
    const response = await fetch('http://127.0.0.1:' + port + '/' + command);
    assert(response.ok, 'Owned Electron fixture command failed.');
    return response.json();
  };
  return {kind: 'Electron', title, child: running.child, state: () => command('state'), command};
}

const reference = ui => ({snapshot: ui.snapshot, element_id: ui.nodes[0].id});
async function clickCount(fixture) {
  return (await waitFor(fixture.state, state => typeof state.clicks === 'number', 'Owned fixture state was unreadable.')).clicks;
}
async function rejectsBeforeInput(request, code) {
  await assert.rejects(worker.request(request), error => {
    assert.equal(error.details.code, code);
    assert.deepEqual(error.details.disposition, {delivery: 'not_delivered', retry: 'safe'});
    return true;
  });
}

try {
  for (const create of [nativeFixture, electronFixture]) {
    const fixture = await create();
    const windows = await waitFor(() => worker.request({action: 'get_windows', query: fixture.title}), result => result.windows.length === 1, 'Owned window was not discovered.');
    const window_id = windows.windows[0].id;
    const window_ref = windows.windows[0].window_ref;
    assert.match(window_ref, /^[a-f0-9]{32}$/);
    await rejectsBeforeInput({action: 'get_ui', window_id, window_ref: '0'.repeat(32)}, 'STALE_REF');
    if (fixture.kind === 'WinForms' && process.argv.includes('--benchmark')) {
      const output = process.argv[process.argv.indexOf('--benchmark') + 1];
      assert(output, '--benchmark requires a report path.');
      await benchmarkIdentity({root, scratch, fixture, windowId: window_id, output: resolve(root, output), waitFor});
    }
    const inspect = (query, depth = 30) => worker.request({action: 'get_ui', window_id, query, max_depth: depth, max_chars: 6000});
    let button = await waitFor(() => inspect('Original item'), ui => ui.nodes.length === 1 && ui.nodes[0].targetable, 'Original control was not capture-proven.');
    const editor = await inspect('Editable field');
    assert.equal(editor.nodes[0].targetable, true);
    const skeleton = await worker.request({action: 'get_ui', window_id, window_ref, view: 'skeleton', query: 'Nested region', max_depth: 30});
    assert.equal(skeleton.complete, true);
    assert.equal(skeleton.nodes.length, 1, 'Named container was not discoverable.');
    assert.equal(skeleton.nodes[0].targetable, true);
    assert(skeleton.nodes.every(node => node.value === undefined), 'Skeleton exposed value previews.');
    const subtree = await worker.request({action: 'get_ui', window_id, window_ref, root_snapshot: skeleton.snapshot, root_element_id: skeleton.nodes[0].id, max_depth: 30});
    assert.equal(subtree.nodes.length, 1, 'Subtree included controls from outside the root.');
    assert.equal(subtree.nodes[0].name, 'Nested field');
    const whole = await worker.request({action: 'get_ui', window_id, window_ref, max_depth: 30, max_elements: 100, max_chars: 16000});
    assert.equal(whole.complete, true, 'Dense fixture observation was incomplete.');
    assert(whole.nodes.length >= 30, 'Dense fixture did not expose its unrelated controls.');
    const wholeChars = JSON.stringify(whole).length, subtreeChars = JSON.stringify(subtree).length;
    assert(subtreeChars < wholeChars * 0.4, 'Rooted discovery did not substantially reduce response context.');
    discoverySizes.push({fixture: fixture.kind, whole_controls: whole.nodes.length, subtree_controls: subtree.nodes.length,
      whole_characters: wholeChars, subtree_characters: subtreeChars, reduction_percent: 100 * (1 - subtreeChars / wholeChars)});
    await worker.request({action: 'set_value', ...reference(subtree), text: 'verified subtree edit'});
    await waitFor(fixture.state, state => state.nested === 'verified subtree edit', 'Subtree edit did not reach the owned field.');
    await fixture.command('value');
    await worker.request({action: 'set_value', ...reference(editor), text: 'updated through original reference'});
    await waitFor(fixture.state, state => state.text === 'updated through original reference', 'Editing through the original ref did not work.');
    await fixture.command('title');
    await worker.request({action: 'invoke', ...reference(button)});
    await waitFor(fixture.state, state => state.clicks === 1, 'Title drift incorrectly prevented invocation.');
    const fieldChanges = fixture.kind === 'WinForms' ? ['automation-id', 'description', 'role'] : ['automation-id', 'role'];
    for (const changed of fieldChanges) {
      const prior = await waitFor(() => inspect('Original item'), ui => ui.nodes.length === 1 && ui.nodes[0].automation_id === 'action' && ui.nodes[0].role === 'Button', 'Reset identity was not exposed by accessibility.');
      assert.equal(prior.nodes.length, 1);
      assert.equal(prior.nodes[0].targetable, true);
      assert.equal(prior.nodes[0].automation_id, 'action');
      await fixture.command(changed);
      if (changed !== 'description') {
        await waitFor(() => inspect('Original item'), ui => ui.nodes.length === 1 && (changed === 'automation-id'
          ? ui.nodes[0].automation_id === 'replacement-action' : ui.nodes[0].role === 'CheckBox'), 'Changed ' + changed + ' was not exposed by accessibility.');
      }
      await rejectsBeforeInput({action: 'invoke', ...reference(prior)}, 'STALE_REF');
      assert.equal(await clickCount(fixture), 1, changed + ' drift dispatched an input.');
      await fixture.command('identity-reset');
    }
    button = await waitFor(() => inspect('Original item'), ui => ui.nodes.length === 1 && ui.nodes[0].automation_id === 'action' && ui.nodes[0].role === 'Button', 'Reset button was not exposed by accessibility.');
    await fixture.command('rename');
    const replacement = await waitFor(() => inspect('Replacement item'), ui => ui.nodes.length === 1 && ui.nodes[0].targetable, 'Replacement control not observed.');
    await rejectsBeforeInput({action: 'invoke', ...reference(button)}, 'STALE_REF');
    assert.equal(await clickCount(fixture), 1, 'Stale control invocation changed the fixture.');
    await worker.request({action: 'invoke', ...reference(replacement)});
    await waitFor(fixture.state, state => state.clicks === 2, 'Fresh replacement reference did not work.');
    await fixture.command('hide');
    const runtime = {windows: worker, companion: {state: {paused: false}}};
    const gone = await runWindowsRequest(runtime, {action: 'wait_for', window_id, window_ref, ...reference(replacement), query: 'Replacement item', control_type: 'Button', wait_condition: 'absent', timeout_ms: 2000, max_depth: 30});
    assert.equal(gone.verified, true);
    assert.equal(gone.condition, 'absent');
    await fixture.command('show');
    if (fixture.kind === 'Electron') {
      await fixture.command('twin');
      const twins = await waitFor(() => inspect('Replacement item'), ui => ui.nodes.length === 2, 'Twin controls did not appear.');
      assert(twins.nodes.every(node => node.targetable === false), 'Ambiguous controls received capture proof.');
      await rejectsBeforeInput({action: 'invoke', ...reference(replacement)}, 'AMBIGUOUS_TARGET');
      await rejectsBeforeInput({action: 'invoke', ...reference(twins)}, 'AMBIGUOUS_TARGET');
      assert.equal(await clickCount(fixture), 2, 'An ambiguous reference clicked a twin.');
    } else {
      const partial = await inspect('Replacement item', 1);
      assert.equal(partial.complete, false);
      assert.equal(partial.nodes[0].targetable, false);
      await rejectsBeforeInput({action: 'invoke', ...reference(partial)}, 'INCOMPLETE_SNAPSHOT');
    }
    const liveEditor = await inspect('Editable field');
    await stop(fixture.child);
    await rejectsBeforeInput({action: 'set_value', ...reference(liveEditor), text: 'must not be sent'}, 'STALE_REF');
    console.log('PASS: ' + fixture.kind + ' verifies dense rooted discovery, subtree editing, pinned absence, and independent name/ID/role' + (fixture.kind === 'WinForms' ? '/description' : '') + ' rejection.');
  }
  if (process.argv.includes('--discovery-report')) {
    const output = process.argv[process.argv.indexOf('--discovery-report') + 1];
    assert(output, '--discovery-report requires a path.');
    await writeFile(resolve(root, output), JSON.stringify({created_at: new Date().toISOString(), scenarios: discoverySizes,
      scope: 'Owned dense WinForms/Electron fixtures. Character counts measure returned JSON context, not execution speed or coverage of unexposed controls.'}, null, 2) + '\n');
  }
} finally {
  worker.close();
  for (const child of children) await stop(child);
  const verified = await realpath(scratch);
  assert.equal(dirname(verified).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
  assert(verified.split(/[\\/]/).at(-1).startsWith('pokemon-identity-'));
  await rm(verified, {recursive: true, force: true});
}
