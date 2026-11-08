import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import {dirname, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {connect} from './client.mjs';

assert.equal(process.platform, 'win32');
const session = await connect({stderr: 'pipe', env: {...process.env, POKEMON_TIMING: '1', POKEMON_UI: 'on'}});
const {root} = session;
const scratch = await mkdtemp(resolve(os.tmpdir(), 'pokemon-keyboard-guard-'));
const fixtures = [];
const timing = [];
let buffer = '';
session.transport.stderr.on('data', chunk => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.startsWith('[pokemon-timing] ')) timing.push(JSON.parse(line.slice(17)));
  }
});
const api = async args => JSON.parse((await session.call('windows', args)).content[0].text);
const state = async fixture => (await fetch(fixture.url + '/state', {signal: AbortSignal.timeout(5000)})).json();
const distribution = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return {samples: sorted.length, median_ms: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2, p95_ms: sorted[Math.ceil(sorted.length * .95) - 1]};
};
let original;
try {
  await session.call('pokemon', {action: 'task', message: 'Checking keyboard foreground protection'});
  original = (await api({action: 'get_windows'})).windows.find(window => window.active);
  for (const name of ['A', 'B']) {
    const title = 'Pokémon Guard ' + name + ' ' + randomUUID().slice(0, 8);
    const appData = resolve(scratch, name);
    await mkdir(appData);
    const env = {...process.env, POKEMON_INPUT_FIXTURE_DATA: appData, POKEMON_INPUT_FIXTURE_TITLE: title, POKEMON_INPUT_FIXTURE_KEYCOUNT: '1'};
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(resolve(root, 'frontend/node_modules/electron/dist/electron.exe'), [resolve(root, 'scripts/input-fixture/index.cjs'), '--force-renderer-accessibility'], {env, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit']});
    const fixture = {child, title};
    fixtures.push(fixture);
    await new Promise((ready, reject) => {
      const timeout = setTimeout(() => reject(new Error('Guard fixture did not open.')), 15000);
      let output = '';
      child.stdout.on('data', chunk => {
        output += chunk;
        for (const line of output.split('\n')) {
          try { const value = JSON.parse(line); if (value.port) { fixture.url = 'http://127.0.0.1:' + value.port; clearTimeout(timeout); ready(); } } catch {}
        }
      });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Guard fixture exited.')); });
    });
    const listed = await api({action: 'get_windows', query: title});
    assert.equal(listed.windows.length, 1);
    fixture.window_id = listed.windows[0].id;
  }
  const [a, b] = fixtures;
  const observed = [];
  for (const mode of ['mismatch', 'match']) {
    const active = mode === 'mismatch' ? b : a;
    let previousEvents = 0;
    await fetch(active.url + '/focus', {method: 'POST'});
    await api({action: 'batch', steps: [
      {action: 'get_ui', window_id: active.window_id, query: 'Test note', control_type: 'Edit'},
      {action: 'focus', target_step: 0},
    ]});
    for (let run = 0; run < 40; run += 1) {
      const current = await api({action: 'get_windows', query: active.title});
      assert.equal(current.windows[0].active, true);
      assert.equal((await state(active)).focusedElement, 'note');
      const action = run % 2 ? 'type' : 'key';
      const args = {action, text: action === 'key' ? 'f8' : '7', window_id: a.window_id};
      if (mode === 'mismatch') await assert.rejects(session.call('computer', args), /Foreground window mismatch.*No input was sent/);
      else await session.call('computer', args);
      let aState = await state(a);
      const deadline = Date.now() + 1000;
      const code = action === 'key' ? 'F8' : 'Digit7';
      while (mode === 'match' && (aState.keys.logical < run + 1 || !aState.keys.events.slice(previousEvents).some(([phase, , keyCode]) => phase === 'up' && keyCode === code)) && Date.now() < deadline) {
        await delay(10);
        aState = await state(a);
      }
      const bState = await state(b);
      const expected = mode === 'match' ? run + 1 : 0;
      assert.equal(aState.keys.logical, expected, JSON.stringify({mode, run, action, aState}));
      assert(aState.keys.up >= expected, 'Every submitted key must be released; IMEs can emit additional Process/key-up events.');
      if (mode === 'match') assert(aState.keys.events.slice(previousEvents).some(([phase, , keyCode]) => phase === 'up' && keyCode === code), 'The submitted physical key must be released, including IME-wrapped releases.');
      assert.deepEqual(bState.keys, {down: 0, up: 0, logical: 0, events: []});
      if (mode === 'mismatch') assert.deepEqual(aState.keys.events, [], 'Blocked calls must send no events, including modifiers.');
      assert.equal(aState.text, mode === 'match' ? '7'.repeat(Math.floor((run + 1) / 2)) : '');
      assert.equal(bState.text, '');
      observed.push({mode, run, action, a: {...aState.keys, events: aState.keys.events.slice(previousEvents)}, b: bState.keys, verified: true});
      previousEvents = aState.keys.events.length;
    }
  }
  await delay(50);
  const guards = timing.filter(row => row.breakdown_ms.foreground_guard !== undefined);
  assert.equal(guards.length, 80);
  const windows = timing.filter(row => row.tool === 'windows' && row.action === 'get_windows');
  const report = {measured_at: new Date().toISOString(), companion: 'on', runs_per_mode: 40, actions: 'alternating key F8 and type 7', counter: 'F8 key-downs plus input events; raw DOM events retain extra IME Process wrappers', guard: distribution(guards.map(row => row.breakdown_ms.foreground_guard)), get_windows: distribution(windows.map(row => row.total_ms)), observed, timing};
  await mkdir(resolve(root, 'benchmarks/results'), {recursive: true});
  await writeFile(resolve(root, 'benchmarks/results/keyboard-guard-2026-11-07.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('PASS: 40 mismatches sent zero events to both windows; 40 matches delivered exactly 20 F8 presses and 20 typed digits to A, with all F8 releases verified. Raw events retain IME Process wrappers. Both key and type covered, zero screenshots.');
  console.log(JSON.stringify({guard: report.guard, get_windows: report.get_windows}));
  await session.call('pokemon', {action: 'done', message: 'Keyboard foreground guard verified'});
} finally {
  for (const fixture of fixtures) {
    if (fixture.url) await fetch(fixture.url + '/quit', {method: 'POST'}).catch(() => {});
    fixture.child.kill();
  }
  if (original) await api({action: 'activate', window_id: original.id}).catch(() => {});
  await session.client.close();
  const resolvedScratch = await realpath(scratch);
  assert.equal(dirname(resolvedScratch).toLowerCase(), (await realpath(os.tmpdir())).toLowerCase());
  assert(resolvedScratch.toLowerCase().includes('pokemon-keyboard-guard-'));
  await rm(resolvedScratch, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
}
