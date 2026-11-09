import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import {dirname, relative, resolve, sep} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {connect} from './client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = {runs: 20, fixture: 'plain', output: `benchmarks/results/windows-batch-${new Date().toISOString().slice(0, 10)}.json`};
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index];
  const value = process.argv[index + 1];
  if (flag === '--runs' && value !== undefined) options.runs = Number(value);
  else if (flag === '--fixture' && ['plain', 'nested'].includes(value)) options.fixture = value;
  else if (flag === '--output' && value?.endsWith('.json')) options.output = value;
  else throw new Error('Usage: npm run benchmark:windows -- --runs 20 --fixture plain|nested --output benchmarks/results/run.json');
}
assert(process.platform === 'win32', 'This benchmark requires a Windows desktop session.');
assert(Number.isInteger(options.runs) && options.runs >= 5 && options.runs <= 100, '--runs must be 5..100.');

const scratch = await mkdtemp(resolve(os.tmpdir(), 'pokemon-windows-benchmark-'));
const title = `Pokémon Benchmark ${randomUUID().slice(0, 8)}`;
let fixture;
let fixtureUrl;
let session;
let sequence = 0;
let expectedClicks = 0;
const samples = [];
const startup = [];

async function launchFixture() {
  const appData = resolve(scratch, 'fixture');
  await mkdir(appData);
  const env = {...process.env, APPDATA: appData, POKEMON_INPUT_FIXTURE_TITLE: title, POKEMON_INPUT_FIXTURE_WRAPPERS: options.fixture === 'nested' ? '1' : '0'};
  delete env.ELECTRON_RUN_AS_NODE;
  fixture = spawn(resolve(root, 'frontend/node_modules/electron/dist/electron.exe'), [resolve(root, 'scripts/input-fixture/index.cjs'), '--force-renderer-accessibility'], {env, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit']});
  await new Promise((ready, reject) => {
    const timer = setTimeout(() => reject(new Error('Benchmark fixture did not become ready.')), 15000);
    let buffer = '';
    fixture.stdout.on('data', (data) => {
      buffer += data;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const value = JSON.parse(line);
          if (value.port) { fixtureUrl = `http://127.0.0.1:${value.port}`; clearTimeout(timer); ready(); }
        } catch {}
      }
    });
    fixture.once('error', (error) => {clearTimeout(timer); reject(error);});
    fixture.once('exit', () => {clearTimeout(timer); reject(new Error('Benchmark fixture exited.'));});
  });
}

async function openSession(name) {
  const appData = resolve(scratch, name);
  await mkdir(appData);
  const beforeConnect = performance.now();
  session = await connect({env: {...process.env, APPDATA: appData, POKEMON_UI: 'on'}});
  const connected = performance.now();
  await session.call('pokemon', {action: 'task', message: 'Benchmarking atomic and batch Windows APIs'});
  startup.push({session: name, mcp_connect_ms: connected - beforeConnect, companion_start_ms: performance.now() - connected});
}

async function workflow(mode, phase, pair) {
  sequence += 1;
  const text = `Benchmark ${String(sequence).padStart(6, '0')} — Pokémon Xin chào!`;
  const metric = {mode, phase, pair, elapsed_ms: 0, mcp_calls: 0, request_json_chars: 0, request_json_bytes: 0, response_json_chars: 0, response_json_bytes: 0, response_text_chars: 0, screenshot_images: 0};
  const api = async (args) => {
    const request = JSON.stringify({name: 'windows', arguments: args});
    metric.mcp_calls += 1;
    metric.request_json_chars += request.length;
    metric.request_json_bytes += Buffer.byteLength(request);
    const result = await session.call('windows', args);
    const response = JSON.stringify(result);
    metric.response_json_chars += response.length;
    metric.response_json_bytes += Buffer.byteLength(response);
    metric.screenshot_images += result.content.filter((item) => item.type === 'image').length;
    const content = result.content.filter((item) => item.type === 'text');
    assert.equal(content.length, 1);
    metric.response_text_chars += content[0].text.length;
    return JSON.parse(content[0].text);
  };
  const step = (args) => ({...args, max_chars: 2000});
  const before = performance.now();
  let final;
  if (mode === 'atomic') {
    const listed = await api(step({action: 'get_windows', query: title}));
    assert.equal(listed.windows.length, 1);
    assert(!listed.truncated);
    const window_id = listed.windows[0].id;
    const editor = await api(step({action: 'get_ui', window_id, query: 'Test note', control_type: 'Edit'}));
    assert.equal(editor.matched, 1);
    assert(!editor.truncated && editor.nodes[0].actions.includes('set_value'));
    await api(step({action: 'set_value', snapshot: editor.snapshot, element_id: editor.nodes[0].id, text}));
    const button = await api(step({action: 'get_ui', window_id, query: 'Verify input', control_type: 'Button'}));
    assert.equal(button.matched, 1);
    assert(!button.truncated && button.nodes[0].actions.includes('invoke'));
    await api(step({action: 'invoke', snapshot: button.snapshot, element_id: button.nodes[0].id}));
    final = await api(step({action: 'get_ui', window_id, query: 'Test note', control_type: 'Edit'}));
  } else {
    const result = await api({action: 'batch', max_chars: 2000, steps: [
      step({action: 'get_windows', query: title}),
      step({action: 'get_ui', window_step: 0, query: 'Test note', control_type: 'Edit'}),
      step({action: 'set_value', target_step: 1, text}),
      step({action: 'get_ui', window_step: 0, query: 'Verify input', control_type: 'Button'}),
      step({action: 'invoke', target_step: 3}),
      step({action: 'get_ui', window_step: 0, query: 'Test note', control_type: 'Edit', expect_value: text}),
    ]});
    assert.equal(result.ok, true);
    assert.equal(result.completed, 6);
    assert(!result.truncated);
    final = result.result;
  }
  assert.equal(final.matched, 1);
  assert(!final.truncated);
  assert(!final.nodes[0].value_clipped);
  assert.equal(final.nodes[0].value, text);
  metric.elapsed_ms = performance.now() - before;
  assert.equal(metric.screenshot_images, 0);
  assert.equal(metric.mcp_calls, mode === 'atomic' ? 6 : 1);
  // Independent fixture verification is outside the timer, equally for both modes.
  expectedClicks += 1;
  const state = await (await fetch(fixtureUrl, {signal: AbortSignal.timeout(5000)})).json();
  assert.equal(state.text, text);
  assert.equal(state.clicks, expectedClicks);
  metric.verified = true;
  return metric;
}

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    min: sorted[0], median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted.at(-1), mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

function summary(mode) {
  const runs = samples.filter((item) => item.mode === mode && item.phase === 'warm');
  return {
    runs: runs.length, elapsed_ms: distribution(runs.map((item) => item.elapsed_ms)),
    ...Object.fromEntries(['mcp_calls', 'request_json_chars', 'request_json_bytes', 'response_json_chars', 'response_json_bytes', 'response_text_chars', 'screenshot_images'].map((key) => [key, distribution(runs.map((item) => item[key])).median])),
  };
}

function markdown(report) {
  const a = report.summary.atomic;
  const b = report.summary.batch;
  const ms = (n) => `${n.toFixed(1)} ms`;
  const pct = (n) => `${n.toFixed(1)}%`;
  return `# Windows atomic versus batch benchmark

Measured at ${report.measured_at}, source revision \`${report.source_revision}\`. Fixture: **${options.fixture}**${options.fixture === 'nested' ? ' (35 anonymous ARIA groups around the field and button)' : ''}. ${options.runs} warm runs per mode, with alternating order in each pair. All ${samples.length} recorded workflows passed independent field and button checks; no screenshot images were returned.

| Metric | Atomic | Batch |
| --- | ---: | ---: |
| Windows API steps per workflow | 6 | 6 |
| MCP calls per workflow | ${a.mcp_calls} | ${b.mcp_calls} |
| Warm median execution | ${ms(a.elapsed_ms.median)} | ${ms(b.elapsed_ms.median)} |
| Warm p95 execution | ${ms(a.elapsed_ms.p95)} | ${ms(b.elapsed_ms.p95)} |
| Median request JSON characters | ${a.request_json_chars} | ${b.request_json_chars} |
| Median result text characters | ${a.response_text_chars} | ${b.response_text_chars} |
| Median result JSON characters | ${a.response_json_chars} | ${b.response_json_chars} |
| Median result JSON UTF-8 bytes | ${a.response_json_bytes} | ${b.response_json_bytes} |
| Screenshot images | 0 | 0 |

MCP calls decreased by ${pct(report.reductions.mcp_calls_pct)} and result text by ${pct(report.reductions.response_text_chars_pct)}. Warm median execution changed by ${pct(report.reductions.warm_median_execution_pct)} (positive means faster for batch).

## Method

The same visible disposable Electron window and the real Pokémon overlay are used for both modes. Each workflow discovers that uniquely named window, discovers its Edit control, sets a unique Unicode value, discovers the Verify button, invokes it, and reads the field again. Both modes use identical UI filters and per-step 2,000-character budgets. Batch additionally checks the expected field value inside the server. An independent HTTP fixture check validates the text and exactly one button click after every run, outside the timer.

The timer covers the six API steps, MCP stdio transport, result parsing, and companion updates. It excludes MCP connection, companion launch, fixture launch, and independent HTTP verification. First-in-session runs below use separate MCP processes and an already started overlay; they are single observations, not cold-start latency measurements. The server eagerly starts its native worker before the workflow, and loads the compiled DLL when present. Connection/overlay startup times are recorded separately. The warm session performs one unreported warmup workflow per mode before the ${options.runs} alternating pairs. Warm p95 uses nearest rank; medians average the two middle samples when needed. Every recorded sample is in the adjacent JSON file; the two verified warmups are excluded from the summaries.

| First workflow in a separate session (one observation each) | Execution |
| --- | ---: |
${samples.filter((item) => item.phase === 'first_in_session').map((item) => `| ${item.mode} | ${ms(item.elapsed_ms)} |`).join('\n')}

This is a local tool benchmark with no AI inference or network model latency. Six calls versus one offers five fewer opportunities for a sequential model round trip, but no end-to-end AI speedup or dollar/token saving is measured. Characters/bytes are measured, not tokenizer counts. Request/result JSON measurements exclude JSON-RPC envelopes, tool schemas, initialization, and Pokémon task announcement calls. Windows API operations still execute individually inside a batch. Results vary with the app, machine load and accessibility tree; this small fixture does not establish performance for arbitrary apps.

## Environment

- Platform: ${report.environment.platform} ${report.environment.os_release}, ${report.environment.arch}
- CPU: ${report.environment.cpu}; ${report.environment.logical_cpus} logical processors
- Node: ${report.environment.node}; Electron: ${report.environment.electron}
- Overlay: enabled; transport: stdio
- Worker execution policy environment: ${report.environment.powershell_process_policy || 'not set'} (inherited for these test processes only)
- Reproduce after building the backend/frontend: npm run benchmark:windows -- --runs ${options.runs} --fixture ${options.fixture} --output ${relative(root, resolve(root, options.output)).split(sep).join('/')}
- Raw data includes SHA-256 hashes of the built backend files used in this run.
`;
}

try {
  await launchFixture();
  for (const mode of ['atomic', 'batch']) {
    await openSession(`fresh-${mode}`);
    samples.push(await workflow(mode, 'first_in_session', 0));
    console.log(`${mode}: first workflow ${samples.at(-1).elapsed_ms.toFixed(1)} ms`);
    await session.client.close();
    session = undefined;
  }
  await openSession('warm');
  await workflow('atomic', 'warmup', 0);
  await workflow('batch', 'warmup', 0);
  for (let pair = 1; pair <= options.runs; pair += 1) {
    const order = pair % 2 ? ['atomic', 'batch'] : ['batch', 'atomic'];
    for (const mode of order) samples.push(await workflow(mode, 'warm', pair));
    if (pair % 5 === 0) console.log(`Verified ${pair}/${options.runs} warm pairs`);
  }
  const builtFiles = ['backend/dist/main.js', 'backend/dist/tools/windows.js', 'backend/dist/windows/batch.js', 'backend/dist/windows/automation.js', 'backend/dist/windows/uia-worker.cs', 'backend/dist/windows/uia-worker.ps1', 'backend/dist/windows/uia-worker.dll', 'backend/dist/pokemon/runtime.js', 'backend/dist/pokemon/companion.js', 'scripts/input-fixture/index.cjs', 'scripts/input-fixture/index.html', 'scripts/input-fixture/renderer.js', 'scripts/windows-benchmark.mjs'];
  const hashes = await Promise.all(builtFiles.map(async (file) => [file, createHash('sha256').update(await readFile(resolve(root, file))).digest('hex')]));
  const atomic = summary('atomic');
  const batch = summary('batch');
  const reduction = (a, b) => 100 * (a - b) / a;
  const report = {
    schema_version: 2, measured_at: new Date().toISOString(), runs_per_mode: options.runs,
    source_revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    fixture: {kind: options.fixture, anonymous_group_depth: options.fixture === 'nested' ? 35 : 0},
    environment: {platform: process.platform, os_release: os.release(), arch: process.arch, cpu: os.cpus()[0].model.trim(), logical_cpus: os.cpus().length, node: process.version, electron: JSON.parse(await readFile(resolve(root, 'frontend/node_modules/electron/package.json'), 'utf8')).version, overlay: 'enabled', transport: 'stdio', powershell_process_policy: process.env.PSExecutionPolicyPreference || null},
    workflow: {native_steps: 6, field_and_button_verified_each_run: true, inference_measured: false, warmup_runs_per_mode: 1, alternating_pair_order: true, chars_are_utf16_code_units: true},
    built_backend_sha256: Object.fromEntries(hashes), startup, summary: {atomic, batch},
    reductions: {mcp_calls_pct: reduction(atomic.mcp_calls, batch.mcp_calls), response_text_chars_pct: reduction(atomic.response_text_chars, batch.response_text_chars), warm_median_execution_pct: reduction(atomic.elapsed_ms.median, batch.elapsed_ms.median)},
    samples,
  };
  const output = resolve(root, options.output);
  await mkdir(dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  await writeFile(output.replace(/\.json$/, '.md'), markdown(report));
  console.table({atomic: {calls: atomic.mcp_calls, median_ms: atomic.elapsed_ms.median.toFixed(1), p95_ms: atomic.elapsed_ms.p95.toFixed(1), result_text_chars: atomic.response_text_chars}, batch: {calls: batch.mcp_calls, median_ms: batch.elapsed_ms.median.toFixed(1), p95_ms: batch.elapsed_ms.p95.toFixed(1), result_text_chars: batch.response_text_chars}});
  console.log(`Saved verified benchmark: ${relative(root, output)}`);
} finally {
  if (fixtureUrl) await fetch(`${fixtureUrl}/quit`, {method: 'POST', signal: AbortSignal.timeout(5000)}).catch(() => {});
  fixture?.kill();
  if (session) await session.client.close();
  // Only remove the exact generated directory, after resolving its parent inside TEMP.
  const resolvedScratch = await realpath(scratch);
  const resolvedTemp = await realpath(os.tmpdir());
  assert.equal(dirname(resolvedScratch).toLowerCase(), resolvedTemp.toLowerCase());
  assert(relative(resolvedTemp, resolvedScratch).startsWith('pokemon-windows-benchmark-'));
  await rm(resolvedScratch, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
}
