import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID, createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import {dirname, resolve, relative} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {connect} from './client.mjs';
import {createRequire} from 'node:module';

const sharp = createRequire(new URL('../backend/package.json', import.meta.url))('sharp');

assert.equal(process.platform, 'win32', 'This benchmark requires a Windows desktop.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, process.argv[2] || 'benchmarks/results/perf-baseline.json');
assert(output.endsWith('.json'), 'Pass an output .json path.');
const runs = 20;
const only = new Set(process.argv.slice(3));
const included = (scenario) => only.size === 0 || only.has(scenario);
await mkdir(dirname(output), {recursive: true});
const scratch = await mkdtemp(resolve(os.tmpdir(), 'pokemon-perf-'));
const title = 'Pokemon Performance ' + randomUUID().slice(0, 8);
const samples = [];
let fixture, fixtureUrl, session;
let sequence = 0, clicks = 0;
async function saveReport(path, contents) {
  const staging = path + '.tmp';
  for (let attempt = 0; ; attempt += 1) {
    try {
      await writeFile(staging, contents);
      await rename(staging, path);
      return;
    } catch (error) {
      // Windows scanners can briefly hold report files; retry writes, never desktop inputs.
      if (attempt === 5 || !['EACCES', 'EPERM', 'EBUSY', 'UNKNOWN'].includes(error.code)) throw error;
      await delay(100 * (attempt + 1));
    }
  }
}
const checkpoint = async () => saveReport(output, JSON.stringify({complete: false, runs, samples}, null, 2) + '\n');

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    min: sorted[0],
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}
assert.deepEqual(distribution([3, 1, 2]), {min: 1, median: 2, p95: 3});

async function openSession(ui, name) {
  const appData = resolve(scratch, name);
  await mkdir(appData);
  const connected = await connect({stderr: 'pipe', env: {...process.env, APPDATA: appData, POKEMON_UI: ui, POKEMON_TIMING: '1'}});
  const logs = [];
  let buffer = '';
  connected.transport.stderr.on('data', (chunk) => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.startsWith('[pokemon-timing] ')) logs.push(JSON.parse(line.slice('[pokemon-timing] '.length)));
    }
  });
  let count = 0;
  return {
    ...connected, logs,
    async api(tool, args) {
      count += 1;
      return connected.call(tool, args);
    },
    async flush() {
      const deadline = performance.now() + 1000;
      while (logs.length < count && performance.now() < deadline) await delay(5);
      assert.equal(logs.length, count, 'Every benchmark call must emit exactly one timing record.');
    },
  };
}

function textResult(result) {
  return JSON.parse(result.content.find((item) => item.type === 'text').text);
}
async function verifyScreenshot(result) {
  const image = result.content.find((item) => item.type === 'image');
  assert.equal(image?.mimeType, 'image/png');
  const metadata = await sharp(Buffer.from(image.data, 'base64')).metadata();
  const dimensions = textResult(result);
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, dimensions.image_width);
  assert.equal(metadata.height, dimensions.image_height);
}
const windows = async (args) => textResult(await session.api('windows', args));
const state = async () => (await fetch(fixtureUrl + '/state', {signal: AbortSignal.timeout(5000)})).json();

async function expectText(expected) {
  const deadline = performance.now() + 1000;
  let actual;
  do {
    actual = await state();
    if (actual.text === expected) return;
    await delay(10);
  } while (performance.now() < deadline);
  assert.equal(actual.text, expected);
}

async function record(ui, scenario, run, execute, verify) {
  await session.flush();
  const startLog = session.logs.length;
  const started = performance.now();
  const result = await execute();
  const elapsed_ms = performance.now() - started;
  await session.flush();
  let verification_error, observed;
  try {
    await verify?.(result);
  } catch (error) {
    observed = await state();
    console.error('Failed fixture verification: ' + JSON.stringify({ui, scenario, run, elapsed_ms, observed, timing: session.logs.slice(startLog)}));
    // Record existing typing failures in the baseline; never continue after losing fixture focus.
    if (!scenario.startsWith('computer_type_') || !observed.focused || observed.focusedElement !== 'note') throw error;
    verification_error = error.message;
  }
  const timing = session.logs.slice(startLog);
  const breakdown_ms = {};
  for (const call of timing) for (const [key, value] of Object.entries(call.breakdown_ms)) breakdown_ms[key] = (breakdown_ms[key] || 0) + value;
  const images = result?.content?.filter((item) => item.type === 'image') || [];
  const payload_bytes = images.reduce((sum, image) => sum + Buffer.from(image.data, 'base64').length, 0);
  samples.push({ui, scenario, run, elapsed_ms, breakdown_ms, server_total_ms: timing.reduce((sum, call) => sum + call.total_ms, 0), payload_bytes, calls: timing.length, timing, verified: !verification_error, ...(verification_error ? {verification_error, observed} : {})});
}

async function editor(window_id) {
  const found = await windows({action: 'get_ui', window_id, query: 'Test note', control_type: 'Edit'});
  assert.equal(found.nodes.length, 1);
  assert(found.nodes[0].actions.includes('set_value'));
  return found;
}
async function prepare(window_id, value = '') {
  await windows({action: 'activate', window_id});
  const found = await editor(window_id);
  await windows({action: 'focus', snapshot: found.snapshot, element_id: found.nodes[0].id});
  // Let the activated Electron edit receive focus before sending the first key.
  await delay(50);
  assert.equal((await state()).focused, true);
  assert.equal((await state()).focusedElement, 'note');
  await session.api('computer', {action: 'key', text: 'ctrl+a'});
  await session.api('computer', {action: 'key', text: 'backspace'});
  if (value) await session.api('computer', {action: 'type', text: value});
  await expectText(value);
  let checked = await editor(window_id);
  if (checked.nodes[0].value !== value) checked = await editor(window_id);
  assert.equal(checked.nodes[0].value, value);
  return found;
}

try {
  const appData = resolve(scratch, 'fixture');
  await mkdir(appData);
  const env = {...process.env, APPDATA: appData, POKEMON_INPUT_FIXTURE_TITLE: title};
  delete env.ELECTRON_RUN_AS_NODE;
  fixture = spawn(resolve(root, 'frontend/node_modules/electron/dist/electron.exe'), [resolve(root, 'scripts/input-fixture/index.cjs'), '--force-renderer-accessibility'], {env, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit']});
  await new Promise((ready, reject) => {
    const timer = setTimeout(() => reject(new Error('Benchmark fixture did not start.')), 15000);
    let buffer = '';
    fixture.stdout.on('data', (data) => {
      buffer += data;
      for (const line of buffer.split('\n')) {
        try {
          const value = JSON.parse(line);
          if (value.port) {fixtureUrl = 'http://127.0.0.1:' + value.port; clearTimeout(timer); ready();}
        } catch {}
      }
    });
    fixture.once('error', (error) => {clearTimeout(timer); reject(error);});
    fixture.once('exit', () => {clearTimeout(timer); reject(new Error('Benchmark fixture exited.'));});
  });

  for (const ui of ['on', 'off']) {
    session = await openSession(ui, 'calibration-' + ui);
    const target = await windows({action: 'get_windows', query: title});
    for (const size of [5, 5, 5]) {
      await prepare(target.windows[0].id);
      const value = '1234 '.repeat(size / 5);
      await record(ui, 'calibration', size, async () => session.api('computer', {action: 'type', text: value}), async () => expectText(value));
    }
    samples.splice(0, samples.length, ...samples.filter((sample) => sample.scenario !== 'calibration'));
    await session.client.close();
    session = undefined;
    console.log('Verified typing calibration: ' + ui);
    for (let run = 1; included('cold_start') && run <= runs; run += 1) {
      const started = performance.now();
      session = await openSession(ui, 'cold-' + ui + '-' + run);
      const connected_ms = performance.now() - started;
      await record(ui, 'cold_start', run, async () => {
        const listed = await windows({action: 'get_windows', query: title});
        assert.equal(listed.windows.length, 1);
        return session.api('computer', {action: 'get_cursor_position'});
      }, (result) => assert.equal(typeof textResult(result).x, 'number'));
      samples.at(-1).elapsed_ms += connected_ms;
      samples.at(-1).connect_ms = connected_ms;
      await session.client.close();
      session = undefined;
      if (run % 5 === 0) console.log('Verified ' + ui + ' cold starts: ' + run + '/' + runs);
    }
    await checkpoint();
    session = await openSession(ui, 'warm-' + ui);
    await session.api('pokemon', {action: 'task', message: 'Measuring desktop tool latency'});
    const listed = await windows({action: 'get_windows', query: title});
    assert.equal(listed.windows.length, 1);
    const window_id = listed.windows[0].id;
    await windows({action: 'activate', window_id});
    const screenshot = await session.api('computer', {action: 'get_screenshot'});
    const imageSize = textResult(screenshot);
    const fixtureState = await state();
    const button = [Math.round(fixtureState.button.x / fixtureState.size.width * imageSize.image_width), Math.round(fixtureState.button.y / fixtureState.size.height * imageSize.image_height)];

    const scenarios = [
      ['windows_get_windows', async () => windows({action: 'get_windows', query: title}), (result) => assert.equal(result.windows.length, 1)],
      ['windows_get_ui_narrow', async () => windows({action: 'get_ui', window_id, query: 'Test note', control_type: 'Edit'}), (result) => assert.equal(result.nodes.length, 1)],
      ['windows_get_ui_wide', async () => windows({action: 'get_ui', window_id, max_elements: 250, max_chars: 16000}), (result) => {assert(result.nodes.some((node) => node.name === 'Test note')); assert.equal(result.truncated, false);}],
      ['windows_set_verify_atomic', null, null],
      ['windows_set_verify_batch', null, null],
      ...[5, 50, 500].map((size) => ['computer_type_' + size, null, null]),
      ['computer_key', null, null],
      ['computer_left_click', async () => session.api('computer', {action: 'left_click', coordinate: button}), async () => {clicks += 1; assert.equal((await state()).clicks, clicks);}],
      ['computer_get_screenshot', async () => session.api('computer', {action: 'get_screenshot'}), verifyScreenshot],
      ['pokemon_say', async () => session.api('pokemon', {action: 'say', message: 'Benchmark progress'}), (result) => assert.equal(textResult(result).message, 'Benchmark progress')],
    ];
    for (const name of only) assert(name === 'cold_start' || scenarios.some(([scenario]) => scenario === name), 'Unknown benchmark scenario: ' + name);
    for (const [scenario, execute, verify] of scenarios.filter(([scenario]) => included(scenario))) {
      console.log('Measuring ' + ui + ': ' + scenario);
      for (let run = 1; run <= runs; run += 1) {
        if (execute) {
          if (scenario === 'computer_left_click') await windows({action: 'activate', window_id});
          await record(ui, scenario, run, execute, verify);
        } else if (scenario.startsWith('windows_set_verify')) {
          const found = await editor(window_id);
          const value = 'Benchmark ' + (++sequence);
          const set = {action: 'set_value', snapshot: found.snapshot, element_id: found.nodes[0].id, text: value};
          const get = {action: 'get_ui', window_id, query: 'Test note', control_type: 'Edit'};
          await record(ui, scenario, run, async () => {
            if (scenario.endsWith('atomic')) {
              await windows(set);
              let result = await windows(get);
              if (result.nodes[0]?.value !== value) result = await windows(get);
              return result;
            }
            const batch = await windows({action: 'batch', steps: [set, {...get, expect_value: value}]});
            assert.equal(batch.ok, true);
            return batch.result;
          }, async (result) => {assert.equal(result.nodes[0].value, value); await expectText(value);});
        } else if (scenario.startsWith('computer_type_')) {
          const size = Number(scenario.split('_').at(-1));
          const value = '1234 '.repeat(size / 5);
          await prepare(window_id);
          await record(ui, scenario, run, async () => session.api('computer', {action: 'type', text: value}), async () => expectText(value));
        } else {
          await prepare(window_id, '12345');
          await record(ui, scenario, run, async () => session.api('computer', {action: 'key', text: 'ctrl+a'}));
          await session.api('computer', {action: 'type', text: '123'});
          await expectText('123');
        }
      }
      await checkpoint();
    }
    await session.api('pokemon', {action: 'done', message: 'Benchmark scenarios verified'});
    await session.client.close();
    session = undefined;
  }
  const summary = [];
  for (const ui of ['on', 'off']) for (const scenario of [...new Set(samples.map((sample) => sample.scenario))]) {
    const group = samples.filter((sample) => sample.ui === ui && sample.scenario === scenario);
    assert.equal(group.length, runs);
    const breakdown_ms = Object.fromEntries([...new Set(group.flatMap((sample) => Object.keys(sample.breakdown_ms)))].map((key) => [key, distribution(group.map((sample) => sample.breakdown_ms[key] || 0))]));
    summary.push({ui, scenario, elapsed_ms: distribution(group.map((sample) => sample.elapsed_ms)), breakdown_ms, payload_bytes: distribution(group.map((sample) => sample.payload_bytes)), verified_runs: group.filter((sample) => sample.verified).length});
  }
  const built = ['main.js', 'pokemon/runtime.js', 'pokemon/companion.js', 'tools/computer.js', 'tools/windows.js', 'windows/automation.js', 'windows/uia-worker.cs', 'windows/uia-worker.ps1', 'windows/uia-worker.dll'];
  const hashes = Object.fromEntries(await Promise.all(built.map(async (file) => [file, createHash('sha256').update(await readFile(resolve(root, 'backend/dist', file))).digest('hex')])));
  const report = {
    complete: true, measured_at: new Date().toISOString(), runs, typing_corpus: '1234 repeated with a trailing space: neutral ASCII under the active input method.', environment: {platform: process.platform, node: process.version, cpu: os.cpus()[0].model, transport: 'stdio'},
    timing_notes: 'Nested spans overlap: worker/tree/post-processing and serialization are included in action; capture_hide/show are included in companion_before/after. Tool total excludes SDK framing; client elapsed includes stdio. Cold start also includes server connection. Fixture setup and independent verification are outside timers.',
    built_sha256: hashes, summary, samples,
  };
  await mkdir(dirname(output), {recursive: true});
  await saveReport(output, JSON.stringify(report, null, 2) + '\n');
  const rows = summary.map((row) => '| ' + row.ui + ' | ' + row.scenario + ' | ' + row.elapsed_ms.min.toFixed(1) + ' | ' + row.elapsed_ms.median.toFixed(1) + ' | ' + row.elapsed_ms.p95.toFixed(1) + ' | ' + row.payload_bytes.median + ' | ' + row.verified_runs + '/20 |');
  await saveReport(output.replace(/\.json$/, '.md'), '# Desktop tool benchmark\n\n20 measured runs per scenario and UI mode. Failed native typing checks are preserved and counted, not retried or treated as success. ' + report.timing_notes + '\n\n| Companion | Scenario | Min ms | Median ms | p95 ms | Image bytes | Verified |\n|---|---|---:|---:|---:|---:|---:|\n' + rows.join('\n') + '\n');
  console.table(summary.map((row) => ({ui: row.ui, scenario: row.scenario, min_ms: row.elapsed_ms.min.toFixed(1), median_ms: row.elapsed_ms.median.toFixed(1), p95_ms: row.elapsed_ms.p95.toFixed(1), image_bytes: row.payload_bytes.median, verified: row.verified_runs + '/20'})));
  console.log('Saved benchmark: ' + relative(root, output));
} finally {
  if (fixtureUrl) await fetch(fixtureUrl + '/quit', {method: 'POST', signal: AbortSignal.timeout(5000)}).catch(() => {});
  fixture?.kill();
  if (session) await session.client.close();
  const resolvedScratch = await realpath(scratch), resolvedTemp = await realpath(os.tmpdir());
  assert.equal(dirname(resolvedScratch).toLowerCase(), resolvedTemp.toLowerCase());
  assert(relative(resolvedTemp, resolvedScratch).startsWith('pokemon-perf-'));
  await rm(resolvedScratch, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
}
