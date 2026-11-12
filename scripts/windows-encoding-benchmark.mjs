import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {cpus, release, tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';

assert.equal(process.platform, 'win32');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert(process.argv[2], 'Pass the saved baseline project root with backend/dist and dependencies.');
const baseline = resolve(process.argv[2]);
assert.notEqual(root.toLowerCase(), baseline.toLowerCase());
const output = resolve(root, process.argv[3] || 'benchmarks/results/windows-encoding-2026-11-12.json');
const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-encoding-bench-'));
const title = 'Encoding Benchmark ' + randomUUID().slice(0, 8);
const workers = {}, samples = [], startup_ms = {}, hashes = {};
const previousTiming = process.env.POKEMON_TIMING;
process.env.POKEMON_TIMING = '0';
let fixture;
const state = async () => {
  try {return JSON.parse(await readFile(resolve(scratch, 'state.json'), 'utf8'));}
  catch (error) {if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}; throw error;}
};
async function waitState(accept) {
  const deadline = performance.now() + 15000;
  while (performance.now() < deadline) {
    const value = await state();
    if (accept(value)) return value;
    await delay(30);
  }
  throw new Error('Owned encoding fixture did not reach expected state.');
}
const quantile = (values, q) => {
  const sorted = values.toSorted((a, b) => a - b), index = (sorted.length - 1) * q;
  return sorted[Math.floor(index)] + (sorted[Math.ceil(index)] - sorted[Math.floor(index)]) * (index % 1);
};
const distribution = values => ({n: values.length, median_ms: quantile(values, .5), p95_ms: quantile(values, .95)});
async function measure(arm, scenario, record = true) {
  const worker = workers[arm];
  const args = scenario === 'status' ? {action: 'status'} : {action: 'get_ui', ...worker.window,
    query: scenario === 'dense' ? 'Other field' : 'Editable field', control_type: 'Edit', max_chars: 16000};
  const start = performance.now(), result = await worker.request(args), elapsed_ms = performance.now() - start;
  if (scenario === 'status') assert.equal(result.worker, 'ready');
  else {
    assert.equal(result.complete, true); assert.equal(result.truncated, false);
    assert.equal(result.nodes.length, scenario === 'dense' ? 30 : 1);
    assert.equal(result.matched, result.nodes.length);
    for (const node of result.nodes) {
      assert.equal(node.targetable, true); assert(node.actions.includes('set_value'));
      assert.equal(node.value, scenario === 'dense' ? 'unrelated value ' + node.name.slice('Other field '.length) : 'initial');
    }
  }
  if (record) samples.push({arm, scenario, elapsed_ms, verified: true});
}
try {
  const compile = resolve(scratch, 'compile.ps1'), executable = resolve(scratch, 'fixture.exe');
  await writeFile(compile, 'param($source,$output)\n$ErrorActionPreference="Stop"\nAdd-Type -Path $source -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions -OutputAssembly $output -OutputType WindowsApplication\n');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', compile, resolve(root, 'scripts/identity-fixture.cs'), executable], {windowsHide: true, stdio: 'inherit'});
  fixture = spawn(executable, [scratch, title], {windowsHide: true, stdio: 'ignore'});
  await waitState(x => x.text === 'initial');
  for (const [arm, project] of [['before', baseline], ['after', root]]) {
    const {WindowsAutomation} = await import(pathToFileURL(resolve(project, 'backend/dist/windows/automation.js')).href);
    const worker = workers[arm] = new WindowsAutomation();
    hashes[arm] = {};
    for (const file of ['automation.js', 'uia-worker.ps1', 'uia-worker.dll', 'uia-worker.cs', 'uia-identity.cs', 'uia-observation.cs', 'uia-profile.cs', 'uia-coordination.cs', 'excel-worker.cs']) hashes[arm][file] = createHash('sha256').update(await readFile(resolve(project, 'backend/dist/windows', file))).digest('hex');
    const start = performance.now();
    assert.equal((await worker.request({action: 'status'})).worker, 'ready');
    startup_ms[arm] = performance.now() - start;
    const listed = await worker.request({action: 'get_windows', query: title});
    assert.equal(listed.windows.length, 1); assert.equal(listed.windows[0].id, (await state()).window_id);
    worker.window = {window_id: listed.windows[0].id, window_ref: listed.windows[0].window_ref};
    for (const scenario of ['status', 'narrow', 'dense']) await measure(arm, scenario, false);
  }
  for (const file of Object.keys(hashes.before).filter(file => !['uia-worker.ps1', 'uia-worker.dll'].includes(file))) assert.equal(hashes.before[file], hashes.after[file], 'Unexpected baseline difference: ' + file);
  for (const scenario of ['status', 'narrow', 'dense']) {
    for (let block = 0; block < 15; block++) for (const arm of ['before', 'after', 'after', 'before']) await measure(arm, scenario);
    console.log('Verified 30 samples per arm: ' + scenario);
  }
  const text = 'Tiếng Việt 日本語 🐱 "quotes" \\ path\n\t\u0001';
  for (const worker of Object.values(workers)) {
    const found = await worker.request({action: 'get_ui', ...worker.window, query: 'Editable field', control_type: 'Edit'});
    const target = {snapshot: found.snapshot, element_id: found.nodes[0].id};
    await worker.withControlLease(() => worker.request({action: 'set_value', ...target, text}));
    await waitState(x => x.text === text);
    assert.equal((await worker.request({action: 'read_text', ...target})).text, text);
    await assert.rejects(worker.request({action: 'invoke', snapshot: '0'.repeat(32), element_id: 1}), error => {
      assert.equal(error.details.code, 'STALE_REF');
      assert.deepEqual(error.details.disposition, {delivery: 'not_delivered', retry: 'safe'});
      return true;
    });
  }
  const summary = {}, comparisons = {};
  for (const scenario of ['status', 'narrow', 'dense']) {
    const values = arm => samples.filter(x => x.arm === arm && x.scenario === scenario).map(x => x.elapsed_ms);
    summary[scenario] = Object.fromEntries(['before', 'after'].map(arm => [arm, distribution(values(arm))]));
    const before = values('before'), after = values('after'), differences = before.map((v, i) => v - after[i]);
    let seed = 0x504f4b45;
    const bootstrap = [];
    for (let run = 0; run < 2000; run++) {
      const selected = [];
      for (let block = 0; block < 15; block++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const index = 2 * Math.floor(seed / 4294967296 * 15);
        selected.push(differences[index], differences[index + 1]);
      }
      bootstrap.push(quantile(selected, .5));
    }
    comparisons[scenario] = {paired_median_saved_ms: quantile(differences, .5), bootstrap_95_ci_ms: [quantile(bootstrap, .025), quantile(bootstrap, .975)]};
  }
  const report = {created_at: new Date().toISOString(), source_revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', windowsHide: true}).trim(),
    environment: {cpu: cpus()[0].model, node: process.version, os: release(), profiling: false, overlay: false},
    startup_ms, hashes, summary, comparisons, samples,
    verification: {timed_requests: samples.length, expected_dense_values: 1800, unicode_writes_and_reads: 2, error_dispositions: 2},
    limits: ['One owned WinForms fixture; no general application speed claim.', 'Adapter/native transport timing excludes MCP framing, overlay and model inference.', 'Thirty warm samples per arm/scenario in fifteen ABBA blocks, one excluded warmup; bootstrap preserves paired blocks.', 'Native source and adapter hashes are identical; DLL hashes can differ after recompilation. Only PowerShell response encoding changes.']};
  await mkdir(dirname(output), {recursive: true}); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({output, summary, comparisons, verification: report.verification}, null, 2));
} finally {
  for (const worker of Object.values(workers)) worker.close();
  if (fixture && fixture.exitCode === null && fixture.signalCode === null) await new Promise(done => {fixture.once('exit', done); fixture.kill();});
  if (previousTiming === undefined) delete process.env.POKEMON_TIMING; else process.env.POKEMON_TIMING = previousTiming;
  const checked = await realpath(scratch);
  assert.equal(dirname(checked).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
  assert(checked.split(/[\\/]/).at(-1).startsWith('pokemon-encoding-bench-'));
  await rm(checked, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
}
