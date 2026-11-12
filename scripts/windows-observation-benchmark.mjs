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
const baselineArg = process.argv.indexOf('--baseline');
assert(baselineArg >= 0 && process.argv[baselineArg + 1], 'Pass --baseline <saved project root with backend/dist and dependencies>.');
const baseline = resolve(process.argv[baselineArg + 1]);
assert.notEqual(baseline.toLowerCase(), root.toLowerCase());
const output = resolve(root, 'benchmarks/results/windows-observation-2026-11-12.json');
const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-observation-bench-'));
const title = 'Observation Benchmark ' + randomUUID().slice(0, 8);
const powershell = resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const previousProfile = process.env.POKEMON_TIMING, previousCache = process.env.POKEMON_UIA_CHILD_CACHE;
process.env.POKEMON_TIMING = '0';
process.env.POKEMON_UIA_CHILD_CACHE = '1';
const workers = {}, startup_ms = {}, hashes = {}, native = [], packing = [], fieldProfiles = [];
let fixture;

const quantile = (values, q) => {
  const sorted = values.toSorted((a, b) => a - b), index = (sorted.length - 1) * q;
  return sorted[Math.floor(index)] + (sorted[Math.ceil(index)] - sorted[Math.floor(index)]) * (index % 1);
};
const distribution = values => ({n: values.length, median_ms: quantile(values, .5), p95_ms: quantile(values, .95)});
const state = async () => {
  try {return JSON.parse(await readFile(resolve(scratch, 'state.json'), 'utf8'));}
  catch (error) {if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}; throw error;}
};
async function waitFor(read, accept) {
  const deadline = performance.now() + 15000;
  while (performance.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await delay(30);
  }
  throw new Error('Owned observation fixture did not reach expected state.');
}
async function command(text) {
  const before = await waitFor(state, x => typeof x.sequence === 'number');
  await writeFile(resolve(scratch, 'command'), text);
  return waitFor(state, x => x.sequence > before.sequence);
}
async function inspect(arm, record = true) {
  const worker = workers[arm];
  const begin = performance.now();
  const result = await worker.request({action: 'get_ui', ...worker.window, query: 'Other field', control_type: 'Edit', max_chars: 16000});
  const elapsed_ms = performance.now() - begin;
  assert(result.complete && !result.truncated);
  assert.equal(result.nodes.length, 30);
  assert.equal(result.matched, 30);
  assert.equal(new Set(result.nodes.map(node => node.name)).size, 30);
  for (const node of result.nodes) {
    assert.equal(node.value, 'unrelated value ' + node.name.slice('Other field '.length));
    assert.equal(node.targetable, true);
  }
  if (record) native.push({arm, elapsed_ms, verified_fields: 30, result_characters: JSON.stringify(result).length});
}
function pack(arm, text, max_chars) {
  return workers[arm].postProcess({text, source: 'synthetic'}, {action: 'read_text', max_chars});
}

try {
  const compile = resolve(scratch, 'compile.ps1'), executable = resolve(scratch, 'fixture.exe');
  await writeFile(compile, "param($source, $output)\n$ErrorActionPreference = 'Stop'\nAdd-Type -Path $source -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions -OutputAssembly $output -OutputType WindowsApplication\n");
  execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', compile, resolve(root, 'scripts/identity-fixture.cs'), executable], {windowsHide: true, stdio: 'inherit'});
  fixture = spawn(executable, [scratch, title], {windowsHide: true, stdio: 'ignore'});
  await waitFor(state, x => x.text === 'initial');
  for (const [arm, project] of [['before', baseline], ['after', root]]) {
    const entry = resolve(project, 'backend/dist/windows/automation.js');
    const {WindowsAutomation} = await import(pathToFileURL(entry).href);
    workers[arm] = new WindowsAutomation();
    hashes[arm] = {};
    for (const file of ['automation.js', 'uia-worker.cs', 'uia-worker.dll']) {
      hashes[arm][file] = createHash('sha256').update(await readFile(resolve(project, 'backend/dist/windows', file))).digest('hex');
    }
    const source = await readFile(resolve(project, 'backend/dist/windows/uia-worker.cs'), 'utf8');
    assert(source.includes(arm === 'before' ? 'node["value"] = Clip(((ValuePattern)pattern).Current.Value' : 'node["value"] = Clip(((ValuePattern)pattern).Cached.Value'));
    const begin = performance.now();
    assert((await workers[arm].request({action: 'status'})).worker === 'ready');
    startup_ms[arm] = performance.now() - begin;
    const listed = await workers[arm].request({action: 'get_windows', query: title});
    const ownedWindow = (await state()).window_id;
    const selected = listed.windows.filter(x => x.id === ownedWindow);
    assert.equal(selected.length, 1, JSON.stringify(listed));
    workers[arm].window = {window_id: selected[0].id, window_ref: selected[0].window_ref};
    await inspect(arm, false);
  }
  // ABBA order limits drift: 15 blocks, 30 warm samples per implementation.
  for (let block = 0; block < 15; block++) {
    for (const arm of ['before', 'after', 'after', 'before']) await inspect(arm);
    if ((block + 1) % 5 === 0) console.log(`Verified native read blocks ${block + 1}/15`);
  }
  // A separate profiling run isolates the changed field-read phase from navigation noise.
  process.env.POKEMON_TIMING = '1';
  for (const arm of ['before', 'after']) {
    workers[arm].close();
    const listed = await workers[arm].request({action: 'get_windows', query: title});
    const ownedWindow = (await state()).window_id;
    const selected = listed.windows.filter(x => x.id === ownedWindow);
    assert.equal(selected.length, 1);
    workers[arm].window = {window_id: selected[0].id, window_ref: selected[0].window_ref};
    let buffer = '';
    workers[arm].worker.stdout.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n'), line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        const response = JSON.parse(line);
        if (response.profile?.counts?.discovery_value_read === 30) fieldProfiles.push({arm,
          elapsed_ms: response.profile.phase_ms.discovery_value_read, fields: 30});
      }
    });
  }
  for (let block = 0; block < 15; block++) {
    for (const arm of ['before', 'after', 'after', 'before']) await inspect(arm, false);
    if ((block + 1) % 5 === 0) console.log(`Verified field profile blocks ${block + 1}/15`);
  }
  process.env.POKEMON_TIMING = '0';
  // Change the fixture independently, then verify each new capture sees it.
  await command('value');
  for (const worker of Object.values(workers)) {
    const result = await worker.request({action: 'get_ui', ...worker.window, query: 'Editable field', control_type: 'Edit'});
    assert.equal(result.nodes[0].value, 'changed outside automation');
    const args = {action: 'set_value', snapshot: result.snapshot, element_id: result.nodes[0].id, text: 'verified fresh write'};
    const written = await worker.withControlLease(() => worker.request(args));
    assert.equal(written.value, args.text);
    await waitFor(state, x => x.text === args.text);
    await command('value');
  }

  const inputs = {
    plain: 'x'.repeat(8000),
    quoted_lines: 'Line "quoted" \\ path\n'.repeat(500).slice(0, 8000),
    emoji: '🐱'.repeat(4000),
    escaped_controls: '\u0001'.repeat(8000),
    mixed_language: 'Tiếng Việt 日本語 🐱 "quoted"\n'.repeat(400).slice(0, 8000),
  };
  const packing_results = {};
  for (const [name, text] of Object.entries(inputs)) {
    const max_chars = 6000;
    packing_results[name] = {input_utf16_units: text.length, max_chars};
    let expected = '';
    for (const character of text) {
      if (JSON.stringify({text: expected + character, source: 'synthetic', truncated: true}).length > max_chars) break;
      expected += character;
    }
    assert.equal(pack('after', text, max_chars).text, expected);
    for (const arm of ['before', 'after']) {
      const result = pack(arm, text, max_chars);
      assert(JSON.stringify(result).length <= max_chars);
      assert(text.startsWith(result.text));
      packing_results[name][arm] = {returned_utf16_units: result.text.length, returned_codepoints: Array.from(result.text).length,
        response_characters: JSON.stringify(result).length, well_formed: result.text.isWellFormed()};
      for (let warmup = 0; warmup < 100; warmup++) pack(arm, text, max_chars);
    }
    for (let block = 0; block < 15; block++) {
      for (const arm of ['before', 'after', 'after', 'before']) {
        const begin = performance.now();
        let units = 0;
        for (let index = 0; index < 200; index++) units += pack(arm, text, max_chars).text.length;
        const elapsed_ms = (performance.now() - begin) / 200;
        assert.equal(units, 200 * packing_results[name][arm].returned_utf16_units);
        packing.push({name, arm, elapsed_ms, operations: 200});
      }
    }
    for (const arm of ['before', 'after']) Object.assign(packing_results[name][arm], distribution(packing.filter(x => x.name === name && x.arm === arm).map(x => x.elapsed_ms)));
  }
  const summary = Object.fromEntries(['before', 'after'].map(arm => [arm, distribution(native.filter(x => x.arm === arm).map(x => x.elapsed_ms))]));
  const before = native.filter(x => x.arm === 'before'), after = native.filter(x => x.arm === 'after');
  const paired_saved_ms = before.map((sample, i) => sample.elapsed_ms - after[i].elapsed_ms);
  let seed = 0x504f4b45;
  const bootstrap = [];
  for (let run = 0; run < 2000; run++) {
    const values = [];
    for (let block = 0; block < 15; block++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const index = 2 * Math.floor(seed / 4294967296 * 15);
      values.push(paired_saved_ms[index], paired_saved_ms[index + 1]);
    }
    bootstrap.push(quantile(values, .5));
  }
  const paired_bootstrap_95_ci_ms = [quantile(bootstrap, .025), quantile(bootstrap, .975)];
  const field_read_phase = Object.fromEntries(['before', 'after'].map(arm => [arm,
    distribution(fieldProfiles.filter(x => x.arm === arm).map(x => x.elapsed_ms))]));
  assert.equal(field_read_phase.before.n, 30);
  assert.equal(field_read_phase.after.n, 30);
  const report = {created_at: new Date().toISOString(), source_revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', windowsHide: true}).trim(),
    baseline: 'Saved working tree immediately before this task\'s edits; earlier uncommitted changes included in both arms.',
    environment: {cpu: cpus()[0].model, node: process.version, os: release(), profiling: false, child_cache: true},
    hashes, startup_ms, summary, paired_median_saved_ms: quantile(paired_saved_ms, .5), paired_bootstrap_95_ci_ms, paired_saved_ms,
    field_read_phase, field_profile_samples: fieldProfiles,
    verification: {native_reads: native.length + fieldProfiles.length, independently_expected_fields: (native.length + fieldProfiles.length) * 30, external_value_changes_seen: 2, independently_verified_writes: 2, packing_oracle_cases: Object.keys(inputs).length},
    packing_results, native_samples: native, packing_samples: packing,
    limits: ['One owned WinForms fixture with 30 fields; not a general speed claim across applications.',
      'Native timings include the WindowsAutomation request and PowerShell worker transport, but exclude MCP/client framing, overlay, AI inference and independent assertions.',
      'Packing timings are a synthetic in-process microbenchmark; each sample averages 200 operations. No token or dollar costs were measured.',
      'Field phase profiles come from a separate profiler-enabled run. They measure the instrumented value read, not internal provider RPC counts; do not add them to the profiler-off timings.',
      'The paired confidence interval resamples 15 ABBA blocks with a fixed seed; it describes this run, not application-wide performance.',
      'Cached discovery reads are fresh per capture, not an atomic whole-window snapshot. Input validation and post-action reads remain live.']};
  await mkdir(dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({output, summary, field_read_phase, paired_median_saved_ms: report.paired_median_saved_ms, verification: report.verification, packing_results}, null, 2));
} finally {
  for (const worker of Object.values(workers)) worker.close();
  if (fixture && fixture.exitCode === null && fixture.signalCode === null) await new Promise(done => {fixture.once('exit', done); fixture.kill();});
  if (previousProfile === undefined) delete process.env.POKEMON_TIMING; else process.env.POKEMON_TIMING = previousProfile;
  if (previousCache === undefined) delete process.env.POKEMON_UIA_CHILD_CACHE; else process.env.POKEMON_UIA_CHILD_CACHE = previousCache;
  const checked = await realpath(scratch);
  assert.equal(dirname(checked).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
  assert(checked.split(/[\\/]/).at(-1).startsWith('pokemon-observation-bench-'));
  await rm(checked, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
}
