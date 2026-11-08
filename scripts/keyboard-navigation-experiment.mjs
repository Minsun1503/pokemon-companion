import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {connect} from './client.mjs';

const app = process.argv[2];
assert(['edge', 'chatgpt'].includes(app), 'Pass edge or chatgpt; bring that app to the foreground before running.');
const prior = process.argv[3] ? JSON.parse(await readFile(process.argv[3], 'utf8')) : undefined;
assert(!prior || (!prior.complete && prior.app === app && prior.samples.length % 2 === 0 && prior.samples.length <= 40), 'Resume only complete pairs from an unfinished comparison of the same app.');
const samples = prior?.samples ?? [];
assert(samples.every((sample, index) => sample.app === app && sample.run === Math.floor(index / 2) && sample.path === (Math.floor(index / 2) % 2 ? ['shortcut', 'uia'] : ['uia', 'shortcut'])[index % 2]), 'Resumed samples must preserve alternating pairs without dropping failures.');
const session = await connect({stderr: 'pipe', env: {...process.env, POKEMON_TIMING: '1', POKEMON_UI: 'on'}});
const timing = [];
let buffer = '', calls = 0, complete = false, failure;
const diagnostics = prior ? [...prior.diagnostics, 'Resumed after restoration failed: ' + prior.failure] : [];
session.transport.stderr.on('data', chunk => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.startsWith('[pokemon-timing] ')) timing.push(JSON.parse(line.slice(17)));
    else diagnostics.push(line);
  }
});
const call = async (name, args) => { calls += 1; return JSON.parse((await session.call(name, args)).content[0].text); };
const windows = args => call('windows', args);
const flush = async () => {
  for (let wait = 0; timing.length < calls && wait < 100; wait += 1) await delay(5);
  assert.equal(timing.length, calls, 'Each measured call must have its server timing.');
};
const distribution = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return {median_ms: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2, p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1]};
};
const query = app === 'edge' ? 'Claude' : 'ChatGPT';
const address = 'Address and search bar';
const value = '127.0.0.1/1234567890';
let windowId, originalAddress;
const settings = () => windows({action: 'get_ui', window_id: windowId, query: 'Search settings', control_type: 'Edit', max_chars: 2000});
const readAddress = () => windows({action: 'get_ui', window_id: windowId, query: address, control_type: 'Edit', max_chars: 2000});
async function settingsForRestoration() {
  try { return await settings(); }
  catch (error) {
    if (!error.message.includes('0x80040201')) throw error;
    diagnostics.push('Restoration read failed with a disappearing control; reread once: ' + error.message);
    await delay(100);
    return settings();
  }
}
async function restore() {
  if (app === 'edge') {
    for (let key = 0; key < 2; key += 1) await call('computer', {action: 'key', text: 'escape', window_id: windowId});
    let field = await readAddress();
    if (field.nodes[0]?.value !== originalAddress) field = await readAddress();
    assert.equal(field.nodes[0]?.value, originalAddress, 'Restore the original address without navigating.');
  } else {
    if (!(await settingsForRestoration()).nodes.length) return;
    await windows({action: 'batch', steps: [
      {action: 'get_ui', window_id: windowId, query: 'Back', control_type: 'Button'},
      {action: 'invoke', target_step: 0},
    ]});
    const deadline = Date.now() + 15000;
    while ((await settingsForRestoration()).nodes.length) {
      assert(Date.now() < deadline, 'Settings did not close; do not replay navigation.');
      await delay(20);
    }
  }
}
try {
  await call('pokemon', {action: 'task', message: 'Comparing UI Automation and direct shortcuts in ' + app});
  const found = await windows({action: 'get_windows', query});
  assert.equal(found.windows.length, 1);
  assert.equal(found.windows[0].active, true, 'Verify foreground before the experiment.');
  windowId = found.windows[0].id;
  if (app === 'edge') {
    const field = await readAddress();
    assert.equal(field.nodes.length, 1);
    assert(!field.nodes[0].value_clipped);
    originalAddress = field.nodes[0].value;
  } else assert.equal((await settings()).nodes.length, 0, 'Start with Settings closed.');
  for (let run = samples.length / 2; run < 20; run += 1) {
    for (const path of run % 2 ? ['shortcut', 'uia'] : ['uia', 'shortcut']) {
      await flush();
      const startLog = timing.length, startCalls = calls, started = performance.now();
      let correct = false, error, inputMethod;
      try {
        if (app === 'edge' && path === 'uia') {
          const result = await windows({action: 'batch', steps: [
            {action: 'get_windows', query},
            {action: 'get_ui', window_step: 0, query: address, control_type: 'Edit'},
            {action: 'set_value', target_step: 1, text: value},
            {action: 'get_ui', window_step: 0, query: address, control_type: 'Edit', expect_value: value},
          ]});
          correct = result.ok && result.result.nodes[0].value === value;
        } else if (app === 'edge') {
          await windows({action: 'activate', window_id: windowId});
          await call('computer', {action: 'key', text: 'ctrl+l', window_id: windowId});
          inputMethod = (await call('computer', {action: 'type', text: value, window_id: windowId})).input_method;
          const result = await windows({action: 'batch', steps: [{action: 'get_ui', window_id: windowId, query: address, control_type: 'Edit', expect_value: value}]});
          correct = result.ok && result.result.nodes[0].value === value;
        } else if (path === 'uia') {
          const result = await windows({action: 'batch', steps: [
            {action: 'get_ui', window_id: windowId, query: 'Open profile menu', control_type: 'Button'},
            {action: 'expand', target_step: 0},
            {action: 'wait_for', window_id: windowId, query: 'Settings Ctrl+,', control_type: 'MenuItem', timeout_ms: 5000},
            {action: 'invoke', target_step: 2},
            {action: 'wait_for', window_id: windowId, query: 'Search settings', control_type: 'Edit', timeout_ms: 5000},
          ]});
          correct = result.ok && result.result.nodes[0].name === 'Search settings';
        } else {
          await call('computer', {action: 'key', text: 'ctrl+,', window_id: windowId});
          const result = await windows({action: 'wait_for', window_id: windowId, query: 'Search settings', control_type: 'Edit', timeout_ms: 5000});
          correct = result.nodes.length === 1 && result.nodes[0].name === 'Search settings';
        }
      } catch (failure) { error = failure.message; }
      const elapsedMs = performance.now() - started, measuredCalls = calls - startCalls;
      await flush();
      const logs = timing.slice(startLog);
      samples.push({app, path, run, correct, error, input_method: inputMethod, foreground_mismatch: error?.includes('Foreground window mismatch') ?? false, mcp_calls: measuredCalls, client_ms: elapsedMs, server_ms: logs.reduce((total, row) => total + row.total_ms, 0), timing: logs});
      await restore();
    }
    if ((run + 1) % 5 === 0) console.log('Processed and restored ' + (run + 1) + '/20 pairs in ' + app);
  }
  complete = true;
  await call('pokemon', {action: 'done', message: 'Keyboard comparison completed and app restored'});
} catch (error) {
  failure = error.message;
  throw error;
} finally {
  const summary = ['uia', 'shortcut'].map(path => {
    const rows = samples.filter(sample => sample.path === path);
    return {path, correct: rows.filter(row => row.correct).length, runs: rows.length, foreground_mismatches: rows.filter(row => row.foreground_mismatch).length, mcp_calls: [...new Set(rows.map(row => row.mcp_calls))], server: distribution(rows.map(row => row.server_ms)), client: distribution(rows.map(row => row.client_ms))};
  });
  const report = {complete, failure, diagnostics, measured_at: new Date().toISOString(), app, runs_per_path: 20, companion: 'on', alternating_order: true, notes: 'Preparation and verified restoration excluded. No Enter, screenshots, or AI inference. Edge numerical URL avoids known Telex alphabetic transformations; this does not establish alphabetic typing correctness.', original_address: originalAddress, test_value: app === 'edge' ? value : undefined, summary, samples};
  await mkdir(resolve(session.root, 'benchmarks/results'), {recursive: true});
  await writeFile(resolve(session.root, 'benchmarks/results/keyboard-navigation-' + app + '-2026-11-07' + (complete ? '' : '-partial-' + Date.now()) + '.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(summary));
  await session.client.close();
}
