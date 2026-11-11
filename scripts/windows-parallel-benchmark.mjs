import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {cpus, release, tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {WindowsAutomation} from '../backend/dist/windows/automation.js';
import {connect} from './client.mjs';

// Experiment only: independent native reads use separate workers. Nothing in
// the production MCP dispatcher changes, and pool snapshots stay in this script.
assert.equal(process.platform, 'win32');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runs = Number(process.argv[2] || 15);
assert(Number.isInteger(runs) && runs >= 5 && runs <= 50, 'Pass 5..50 paired runs.');
const output = resolve(root, process.argv[3] || 'benchmarks/results/windows-parallel-2026-11-11.json');
const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-parallel-'));
const workers = [new WindowsAutomation(), new WindowsAutomation()];
const children = [];
const fixtures = [];
const samples = [];
const timings = [];
const diagnostics = [];
const startup = {};
assert(process.env.POKEMON_HTTP_TOKEN?.length >= 32, 'Supply the running local server Bearer token in POKEMON_HTTP_TOKEN.');
let session, timingBuffer = '', liveHidden = false;

async function live(action, message) {
  const response = await fetch('http://127.0.0.1:3000/mcp', {
    method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-03-26', Authorization: 'Bearer ' + process.env.POKEMON_HTTP_TOKEN},
    body: JSON.stringify({jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: {name: 'pokemon', arguments: {action, ...(message ? {message} : {})}}}),
    signal: AbortSignal.timeout(10000),
  });
  assert(response.ok, 'Running companion did not respond.');
  const value = await response.json();
  assert(!value.error && !value.result.isError, JSON.stringify(value));
}

async function state(fixture) {
  try {return JSON.parse(await readFile(resolve(fixture.directory, 'state.json'), 'utf8'));}
  catch (error) {if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}; throw error;}
}

async function waitFor(read, accept) {
  const deadline = performance.now() + 15000;
  while (performance.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await delay(30);
  }
  throw new Error('Owned fixture did not become ready.');
}

const parse = result => {
  assert(!result.isError, JSON.stringify(result));
  assert(result.content.every(item => item.type === 'text'));
  return JSON.parse(result.content[0].text);
};
const call = async args => parse(await session.call('windows', args));
const distribution = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return {median_ms: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
    p95_ms: sorted[Math.ceil(sorted.length * .95) - 1], min_ms: sorted[0], max_ms: sorted.at(-1)};
};
const summary = (mode, width) => {
  const selected = samples.filter(sample => sample.mode === mode && sample.width === width);
  return {runs: selected.length, ...distribution(selected.map(sample => sample.elapsed_ms))};
};

function requests(width) {
  return Array.from({length: width}, (_, index) => ({action: 'get_ui', window_id: fixtures[index % 2].windowId,
    query: index < 2 ? 'Editable field' : 'Other field', control_type: 'Edit', max_elements: 60, max_chars: 16000, max_depth: 24}));
}

function verifyRead(result, request) {
  assert.equal(result.window.id, request.window_id);
  assert.equal(result.truncated, false);
  assert.equal(result.matched, request.query === 'Editable field' ? 1 : 30);
  for (const node of result.nodes) {
    assert.equal(node.value_clipped, undefined);
    assert.equal(node.value, node.name === 'Editable field' ? 'initial' : 'unrelated value ' + node.name.slice('Other field '.length));
  }
}

async function readGroup(mode, width, record = true) {
  const args = requests(width);
  const begin = performance.now();
  let results;
  if (mode === 'mcp_sequential') {
    results = [];
    for (const request of args) results.push(await call(request));
  } else if (mode === 'mcp_concurrent_queued') {
    results = await Promise.all(args.map(call));
  } else if (mode === 'native_sequential') {
    results = [];
    for (const request of args) results.push(await workers[0].request(request));
  } else if (mode === 'native_concurrent_one_worker') {
    results = await Promise.all(args.map(request => workers[0].request(request)));
  } else if (mode === 'native_parallel_two_workers') {
    // Read-only whitelist; never route activation, mutation or input to the pool.
    assert(args.every(request => request.action === 'get_ui' && !request.snapshot && !request.root_snapshot));
    results = await Promise.all(args.map((request, index) => workers[index % 2].request(request)));
  }
  const elapsed_ms = performance.now() - begin;
  results.forEach((result, index) => verifyRead(result, args[index]));
  if (record) samples.push({mode, width, elapsed_ms, verified_reads: results.length,
    response_chars: JSON.stringify(results).length, snapshots_scoped_to_worker: true});
}

async function workflow(mode, index, record = true) {
  const fixture = fixtures[0];
  const text = 'Parallel experiment ' + index + ' ' + mode;
  const args = [
    {action: 'get_windows', query: fixture.title, max_chars: 2000},
    {action: 'get_ui', window_step: 0, query: 'Editable field', control_type: 'Edit', max_chars: 2000},
    {action: 'set_value', target_step: 1, text, max_chars: 2000},
    {action: 'get_ui', window_step: 0, query: 'Original item', control_type: 'Button', max_chars: 2000},
    {action: 'invoke', target_step: 3, max_chars: 2000},
    {action: 'get_ui', window_step: 0, query: 'Editable field', control_type: 'Edit', expect_value: text, max_chars: 2000},
  ];
  const begin = performance.now();
  let final;
  if (mode === 'batch_workflow') {
    const result = await call({steps: args, max_chars: 2000});
    assert.equal(result.ok, true); assert.equal(result.completed, 6);
    final = result.result;
  } else {
    const listed = await call(args[0]); assert.equal(listed.windows.length, 1); assert(!listed.truncated);
    const window_id = listed.windows[0].id;
    const editor = await call({action: 'get_ui', window_id, query: 'Editable field', control_type: 'Edit', max_chars: 2000});
    await call({action: 'set_value', snapshot: editor.snapshot, element_id: editor.nodes[0].id, text, max_chars: 2000});
    const button = await call({action: 'get_ui', window_id, query: 'Original item', control_type: 'Button', max_chars: 2000});
    await call({action: 'invoke', snapshot: button.snapshot, element_id: button.nodes[0].id, max_chars: 2000});
    final = await call({action: 'get_ui', window_id, query: 'Editable field', control_type: 'Edit', max_chars: 2000});
  }
  const elapsed_ms = performance.now() - begin;
  assert.equal(final.nodes[0].value, text); assert(!final.truncated);
  fixture.clicks++;
  await waitFor(() => state(fixture), value => value.text === text && value.clicks === fixture.clicks);
  if (record) samples.push({mode, width: 6, elapsed_ms, mcp_calls: mode === 'batch_workflow' ? 1 : 6, independently_verified: true});
}

try {
  await live('task', 'Testing parallel inspection on disposable windows');
  const compile = resolve(scratch, 'compile.ps1');
  const executable = resolve(scratch, 'fixture.exe');
  await writeFile(compile, "param($source, $output)\n$ErrorActionPreference = 'Stop'\nAdd-Type -Path $source -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions -OutputAssembly $output -OutputType WindowsApplication\n");
  execFileSync(resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', compile, resolve(root, 'scripts/identity-fixture.cs'), executable], {windowsHide: true, stdio: 'inherit'});
  for (let index = 0; index < 2; index++) {
    const directory = resolve(scratch, 'fixture-' + index);
    await mkdir(directory);
    const title = 'Parallel Fixture ' + randomUUID().slice(0, 8);
    const child = spawn(executable, [directory, title], {windowsHide: true, stdio: 'ignore'});
    children.push(child);
    const fixture = {directory, title, clicks: 0};
    fixtures.push(fixture);
    await waitFor(() => state(fixture), value => value.text === 'initial');
  }
  const warmStart = performance.now();
  await Promise.all(workers.map(worker => worker.request({action: 'status'})));
  startup.two_native_workers_ms = performance.now() - warmStart;
  await live('hide'); liveHidden = true;
  const sessionStart = performance.now();
  session = await connect({stderr: 'pipe', env: {...process.env, MCP_TRANSPORT: 'stdio', POKEMON_UI: 'on',
    POKEMON_PET: 'pikachu', POKEMON_TIMING: '1', POKEMON_USER_DATA_DIR: resolve(scratch, 'companion')}});
  session.transport.stderr.on('data', chunk => {
    timingBuffer += chunk;
    while (timingBuffer.includes('\n')) {
      const end = timingBuffer.indexOf('\n'); const line = timingBuffer.slice(0, end); timingBuffer = timingBuffer.slice(end + 1);
      if (line.startsWith('[pokemon-timing] ')) timings.push(JSON.parse(line.slice(17))); else diagnostics.push(line);
    }
  });
  await session.call('pokemon', {action: 'task', message: 'Measuring queued calls and parallel native reads'});
  startup.mcp_and_overlay_ms = performance.now() - sessionStart;
  for (const fixture of fixtures) {
    const result = await call({action: 'get_windows', query: fixture.title, max_chars: 2000});
    assert.equal(result.windows.length, 1); assert(!result.truncated);
    fixture.windowId = result.windows[0].id;
  }
  const modes = ['mcp_sequential', 'mcp_concurrent_queued', 'native_sequential', 'native_concurrent_one_worker', 'native_parallel_two_workers'];
  for (const width of [2, 4]) {
    for (const mode of modes) await readGroup(mode, width, false);
    for (let pair = 0; pair < runs; pair++) {
      for (const mode of pair % 2 ? [...modes].reverse() : modes) await readGroup(mode, width);
      if ((pair + 1) % 5 === 0) console.log(`Read group ${width}: verified ${pair + 1}/${runs} paired runs`);
    }
    console.log('Verified read group width ' + width, Object.fromEntries(modes.map(mode => [mode, summary(mode, width)])));
  }
  // Independent reads never mutate the fixture.
  for (const fixture of fixtures) {const value = await state(fixture); assert.equal(value.text, 'initial'); assert.equal(value.clicks, 0);}
  for (const mode of ['atomic_workflow', 'batch_workflow']) await workflow(mode, 'warmup', false);
  for (let pair = 0; pair < runs; pair++) {
    for (const mode of pair % 2 ? ['batch_workflow', 'atomic_workflow'] : ['atomic_workflow', 'batch_workflow']) await workflow(mode, pair);
  }
  await delay(100);
  const report = {created_at: new Date().toISOString(), source_revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', windowsHide: true}).trim(),
    environment: {platform: process.platform, os: release(), node: process.version, cpu: cpus()[0].model, logical_cpus: cpus().length},
    timing_scope: 'Warm local execution, transport and result parsing. Verification and startup excluded. No model inference or AI end-to-end latency.',
    limits: ['Two owned WinForms processes; no arbitrary application speedup established.', 'Native worker pool is experimental and bypasses MCP/overlay overhead; compare it with native sequential, not MCP modes.',
      'Pool results contain worker-local snapshots. They cannot be used by the production action worker.', 'Production dispatcher and desktop input serialization remain unchanged.',
      'Only get_ui is sent concurrently to separate workers. Dependent write/click workflows remain sequential.'],
    startup, runs, summary: {}, samples, server_timings: timings, diagnostics};
  for (const width of [2, 4]) for (const mode of modes) report.summary[mode + '_' + width] = summary(mode, width);
  for (const mode of ['atomic_workflow', 'batch_workflow']) report.summary[mode] = summary(mode, 6);
  const rows = Object.entries(report.summary).map(([mode, item]) => `| ${mode} | ${item.runs} | ${item.median_ms.toFixed(1)} | ${item.p95_ms.toFixed(1)} |`).join('\n');
  const workflowTimings = timings.filter(item => item.tool === 'windows').slice(-runs * 7);
  const profile = ['atomic_workflow', 'batch_workflow'].map(mode => {
    const calls = workflowTimings.filter(item => mode === 'batch_workflow' ? item.action === 'batch' : item.action !== 'batch');
    assert.equal(calls.length, runs * (mode === 'batch_workflow' ? 1 : 6));
    return {mode, note: 'Measured six-step dependent workflows only; startup, read-group experiments and warmups excluded.',
      breakdown_median_ms: Object.fromEntries(['queue_wait', 'companion_before', 'action', 'companion_after', 'worker_round_trip', 'uia_tree_walk', 'serialization'].map(key => [key, distribution(calls.map(item => item.breakdown_ms[key] || 0)).median_ms]))};
  });
  report.workflow_profile = profile;
  report.verified_measured_reads = samples.reduce((sum, sample) => sum + (sample.verified_reads || 0), 0);
  report.verified_measured_workflows = samples.filter(sample => sample.independently_verified).length;
  await mkdir(dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  await writeFile(output.replace(/\.json$/, '.md'), `# Parallel Windows inspection experiment\n\nRevision: ${report.source_revision}. ${runs} warm runs per mode; alternating order. Pokémon visible for MCP tests. Two disposable WinForms windows.\n\n| Mode and group width | Runs | Median ms | p95 ms |\n| --- | ---: | ---: | ---: |\n${rows}\n\nAll read results were checked against known field contents; neither field values nor click counts changed during the read experiment. Every dependent workflow was independently checked against the fixture's state file. All completed samples and server timing logs are in the adjacent JSON.\n\nStartup: ${JSON.stringify(startup)}\n\nTiming profile (median per MCP call):\n\n\`\`\`json\n${JSON.stringify(profile, null, 2)}\n\`\`\`\n\n${report.limits.map(limit => '- ' + limit).join('\n')}\n- ${report.timing_scope}\n- Parallel reads are separate observations, not an atomic snapshot of multiple apps.\n- A production pool needs scoped reference routing, pause/cancellation handling, memory limits and protection against provider stalls.\n\nReproduce after building: \`node scripts/windows-parallel-benchmark.mjs ${runs} ${output.slice(root.length + 1).replaceAll('\\', '/')}\`. Requires the existing companion HTTP server on port 3000.\n`);
  console.log('Dependent workflows', report.summary.atomic_workflow, report.summary.batch_workflow);
  console.log('Report saved:', output);
  await session.call('pokemon', {action: 'done', message: 'Parallel inspection experiment verified'});
} finally {
  for (const worker of workers) worker.close();
  if (session) await session.client.close();
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) await new Promise(done => {child.once('exit', done); child.kill();});
  }
  if (liveHidden) {await live('show'); await live('done', 'Parallel inspection test finished');}
  const checkedScratch = await realpath(scratch);
  assert.equal(dirname(checkedScratch).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
  assert(checkedScratch.split(/[\\/]/).at(-1).startsWith('pokemon-parallel-'));
  await rm(checkedScratch, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
}
