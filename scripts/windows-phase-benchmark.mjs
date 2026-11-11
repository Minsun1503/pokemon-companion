import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {randomUUID, createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {cpus, release, tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {connect} from './client.mjs';

assert.equal(process.platform, 'win32');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profileReplay = process.argv.includes('--profile-replay');
const profileOnly = process.argv.includes('--profile') || profileReplay;
const workflowCache = process.argv.includes('--workflow-cache');
const runs = profileOnly ? 3 : 30;
const output = resolve(root, 'benchmarks/results/windows-phases-' + (profileReplay ? 'replay-profile' : profileOnly ? 'pilot' : workflowCache ? 'workflow-cache' : 'controlled') + '-2026-11-11.json');
const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-phases-'));
const title = 'Phase Fixture ' + randomUUID().slice(0, 8);
const samples = [], sessions = [], startup = {}, diagnostics = [];
const query = 'Enter a note and verify the test button';
let fixture, clicks = 0;

const decode = result => {
  assert(!result.isError, JSON.stringify(result));
  return JSON.parse(result.content.find(item => item.type === 'text').text);
};
async function api(session, name, arguments_) {return decode(await session.client.callTool({name, arguments: arguments_}));}
async function state() {
  try {return JSON.parse(await readFile(resolve(scratch, 'state.json'), 'utf8'));}
  catch (error) {if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}; throw error;}
}
async function waitFor(read, accept) {
  const deadline = performance.now() + 15000;
  while (performance.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await delay(30);
  }
  throw new Error('Owned phase fixture did not reach expected state.');
}
async function createSession(arm) {
  const begin = performance.now();
  const session = await connect({stderr: 'pipe', env: {...process.env, MCP_TRANSPORT: 'stdio', POKEMON_UI: 'off',
    POKEMON_TIMING: '1', POKEMON_UIA_CHILD_CACHE: arm === 'current' ? '0' : '1', POKEMON_LEARNING_DIR: resolve(scratch, 'learning-' + arm)}});
  sessions.push(session);
  session.arm = arm;
  session.timings = [];
  let buffer = '';
  session.transport.stderr.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (line.startsWith('[pokemon-timing] ')) session.timings.push(JSON.parse(line.slice(17))); else diagnostics.push(line);
    }
  });
  assert((await api(session, 'desktop', {action: 'status'})).native.ready);
  startup[arm] = performance.now() - begin;
  return session;
}
async function finish(session, task_id) {
  await api(session, 'learning', {action: 'finish', task_id, outcome: 'met', summary: 'Synthetic independently verified benchmark'});
  await api(session, 'learning', {action: 'feedback', task_id, satisfaction: 'satisfied'});
}
async function readMany(session, block, record = true) {
  const listed = await api(session, 'windows', {action: 'get_windows', query: title, max_chars: 2000});
  assert.equal(listed.windows.length, 1);
  const before = session.timings.length;
  const begin = performance.now();
  const result = await api(session, 'windows', {action: 'get_ui', window_id: listed.windows[0].id, query: 'Other field', control_type: 'Edit', max_chars: 16000});
  const elapsed_ms = performance.now() - begin;
  assert(!result.truncated); assert.equal(result.matched, 30);
  for (const node of result.nodes) assert.equal(node.value, 'unrelated value ' + node.name.slice('Other field '.length));
  const timings = await waitFor(() => session.timings.slice(before).filter(x => x.tool === 'windows' && x.action === 'get_ui'), x => x.length >= 1);
  assert.equal(timings.length, 1);
  if (record) samples.push({arm: session.arm, mode: 'read_30_values', block, elapsed_ms, verified: true, timings});
}
async function workflow(session, mode, block, record = true) {
  const text = `Phase test ${session.arm} ${mode} ${block} ${clicks}`;
  let task, preview;
  if (mode === 'atomic_recorded' || mode === 'learned_replay') {
    task = await api(session, 'learning', {action: 'begin', query, parameters: {window: title, text}});
    if (mode === 'learned_replay') {
      const recipe = task.suggestions.find(item => item.kind === 'windows');
      assert(recipe);
      preview = await api(session, 'learning', {action: 'preview', task_id: task.task_id, recipe_id: recipe.recipe_id, parameters: {window: title, text}});
    }
  }
  const windows = args => api(session, 'windows', {...args, ...(task ? {task_id: task.task_id} : {}), max_chars: 2000});
  const before = session.timings.length;
  const begin = performance.now();
  let final;
  if (mode === 'learned_replay') {
    const result = await api(session, 'learning', {action: 'run', task_id: task.task_id, preview_id: preview.preview_id});
    assert.equal(result.completed, 6); final = result.result;
  } else if (mode === 'batch') {
    const result = await windows({steps: [
      {action: 'get_windows', query: title},
      {action: 'get_ui', window_step: 0, query: 'Editable field', control_type: 'Edit'},
      {action: 'set_value', target_step: 1, text},
      {action: 'get_ui', window_step: 0, query: 'Original item', control_type: 'Button'},
      {action: 'invoke', target_step: 3},
      {action: 'get_ui', window_step: 0, query: 'Editable field', control_type: 'Edit', expect_value: text},
    ]});
    assert.equal(result.completed, 6); final = result.result;
  } else {
    const listed = await windows({action: 'get_windows', query: title});
    assert.equal(listed.windows.length, 1); assert(!listed.truncated);
    const window_id = listed.windows[0].id;
    const editor = await windows({action: 'get_ui', window_id, query: 'Editable field', control_type: 'Edit'});
    assert.equal(editor.matched, 1);
    await windows({action: 'set_value', snapshot: editor.snapshot, element_id: editor.nodes[0].id, text});
    const button = await windows({action: 'get_ui', window_id, query: 'Original item', control_type: 'Button'});
    assert.equal(button.matched, 1);
    await windows({action: 'invoke', snapshot: button.snapshot, element_id: button.nodes[0].id});
    final = await windows({action: 'get_ui', window_id, query: 'Editable field', control_type: 'Edit'});
  }
  const elapsed_ms = performance.now() - begin;
  assert.equal(final.nodes[0].value, text); assert(!final.truncated);
  const timingCount = mode === 'learned_replay' || mode === 'batch' ? 1 : 6;
  const timings = await waitFor(() => session.timings.slice(before).filter(x => mode === 'learned_replay' ? x.tool === 'learning' && x.action === 'run' : x.tool === 'windows'), x => x.length >= timingCount);
  assert.equal(timings.length, timingCount);
  clicks++;
  await waitFor(state, value => value.text === text && value.clicks === clicks);
  if (task) await finish(session, task.task_id);
  if (record) samples.push({arm: session.arm, mode, block, elapsed_ms, verified: true, timings,
    workflow_mcp_calls: mode === 'batch' || mode === 'learned_replay' ? 1 : 6});
}
const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * q;
  const lo = Math.floor(index), hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
};
const distribution = values => ({n: values.length, median_ms: quantile(values, .5), q1_ms: quantile(values, .25), q3_ms: quantile(values, .75), iqr_ms: quantile(values, .75) - quantile(values, .25)});
let seed = 0x6f726261;
const random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296;};
function paired(a, b) {
  const differences = a.map((value, index) => value - b[index]), bootstrap = [];
  for (let i = 0; i < 10000; i++) bootstrap.push(quantile(differences.map(() => differences[Math.floor(random() * differences.length)]), .5));
  return {n: differences.length, median_saved_ms: quantile(differences, .5), bootstrap_95_percent_ci_ms: [quantile(bootstrap, .025), quantile(bootstrap, .975)], raw_paired_differences_ms: differences};
}
try {
  const compile = resolve(scratch, 'compile.ps1'), executable = resolve(scratch, 'fixture.exe');
  await writeFile(compile, "param($source, $output)\n$ErrorActionPreference = 'Stop'\nAdd-Type -Path $source -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions -OutputAssembly $output -OutputType WindowsApplication\n");
  execFileSync(resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', compile, resolve(root, 'scripts/identity-fixture.cs'), executable], {windowsHide: true, stdio: 'inherit'});
  fixture = spawn(executable, [scratch, title], {windowsHide: true, stdio: 'ignore'});
  await waitFor(state, value => value.text === 'initial');
  const current = await createSession(profileReplay ? 'cached' : 'current');
  if (profileOnly) {
    if (profileReplay) await workflow(current, 'atomic_recorded', 'warmup', false);
    for (let block = 0; block < runs; block++) {
      if (!profileReplay) await readMany(current, block);
      await workflow(current, profileReplay ? 'learned_replay' : 'atomic_unrecorded', block);
    }
  } else {
    const cached = await createSession('cached');
    if (workflowCache) {
      for (const session of [current, cached]) await workflow(session, 'atomic_unrecorded', 'warmup', false);
      for (let block = 0; block < runs / 2; block++) {
        for (const session of [current, cached, cached, current]) await workflow(session, 'atomic_unrecorded', block);
        if ((block + 1) % 5 === 0) console.log(`Verified workflow cache ABBA blocks ${block + 1}/${runs / 2}`);
      }
    } else {
    await readMany(current, 'warmup', false); await readMany(cached, 'warmup', false);
    // Fifteen ABBA blocks: two runs per arm per block, 30 samples per arm.
    for (let block = 0; block < runs / 2; block++) {
    for (const session of [current, cached, cached, current]) await readMany(session, block);
      if ((block + 1) % 5 === 0) console.log(`Verified cache ABBA blocks ${block + 1}/${runs / 2}`);
    }
    const modes = ['atomic_unrecorded', 'atomic_recorded', 'batch', 'learned_replay'];
    for (const mode of modes) await workflow(cached, mode, 'warmup', false);
    // Counterbalance mode order in adjacent blocks. All share one warm server.
    for (let block = 0; block < runs; block++) {
      for (const mode of block % 2 ? [...modes].reverse() : modes) await workflow(cached, mode, block);
      if ((block + 1) % 5 === 0) console.log(`Verified workflow blocks ${block + 1}/${runs}`);
    }
    }
  }
  await delay(100);
  const summary = {};
  for (const item of samples) {
    const key = item.arm + ':' + item.mode;
    if (summary[key]) continue;
    const selected = samples.filter(x => x.arm === item.arm && x.mode === item.mode);
    const phaseKeys = [...new Set(selected.flatMap(x => x.timings.flatMap(t => Object.keys(t.breakdown_ms))))];
    const countKeys = [...new Set(selected.flatMap(x => x.timings.flatMap(t => Object.keys(t.counts))))];
    summary[key] = {...distribution(selected.map(x => x.elapsed_ms)),
      phase_median_ms: Object.fromEntries(phaseKeys.map(k => [k, quantile(selected.map(x => x.timings.reduce((sum, t) => sum + (t.breakdown_ms[k] || 0), 0)), .5)])),
      count_median: Object.fromEntries(countKeys.map(k => [k, quantile(selected.map(x => x.timings.reduce((sum, t) => sum + (t.counts[k] || 0), 0)), .5)]))};
  }
  const comparisons = {};
  if (!profileOnly) {
    const values = (arm, mode) => samples.filter(x => x.arm === arm && x.mode === mode).map(x => x.elapsed_ms);
    const mode = workflowCache ? 'atomic_unrecorded' : 'read_30_values';
    comparisons.cached_child_navigation = paired(values('current', mode), values('cached', mode));
    if (!workflowCache) for (const mode of ['atomic_recorded', 'batch', 'learned_replay']) comparisons[mode + '_vs_unrecorded'] = paired(values('cached', 'atomic_unrecorded'), values('cached', mode));
  }
  const report = {created_at: new Date().toISOString(), source_revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', windowsHide: true}).trim(),
    native_binary_sha256: createHash('sha256').update(await readFile(resolve(root, 'backend/dist/windows/uia-worker.dll'))).digest('hex'),
    environment: {cpu: cpus()[0].model, node: process.version, os: release()}, startup_ms: startup, runs, summary, comparisons, samples, diagnostics,
    limits: ['Owned WinForms fixture only; no general application speedup established.', 'All samples include optional profiling; profiler-off overhead is not measured.', 'Inclusive phases overlap and must not be added together. UIA navigation and cache fetch share one managed request; span counts do not measure internal provider RPCs.', 'Child caching fetches one parent at a time; observations are not atomic. Completeness, uniqueness, scope, identity checks and immediate action revalidation remain required.', 'Startup is separate; read warmups excluded. Workflow timings exclude begin/preview/finish/feedback and independent state verification.', 'Recorded workflows use explicit synthetic test satisfaction. No user satisfaction or external AI inference time measured.', 'Bootstrap resamples paired observations and reports median paired difference; workflow mode order is counterbalanced, cache arms use ABBA.'],
  };
  await mkdir(dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({output, startup_ms: startup, summary, comparisons}, null, 2));
} finally {
  for (const session of sessions) await session.client.close();
  if (fixture && fixture.exitCode === null && fixture.signalCode === null) await new Promise(done => {fixture.once('exit', done); fixture.kill();});
  const checked = await realpath(scratch);
  assert.equal(dirname(checked).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
  assert(checked.split(/[\\/]/).at(-1).startsWith('pokemon-phases-'));
  await rm(checked, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
}
