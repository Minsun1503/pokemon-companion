import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {nativeWorker} from './native-worker-client.mjs';

export async function benchmarkIdentity({root, scratch, fixture, windowId, output, waitFor}) {
  const baseline = resolve(scratch, 'baseline');
  await mkdir(baseline);
  for (const file of ['uia-worker.cs', 'uia-worker.ps1', 'excel-worker.cs']) {
    const source = execFileSync('git', ['show', 'HEAD:backend/src/windows/' + file], {cwd: root, encoding: 'utf8', windowsHide: true});
    await writeFile(resolve(baseline, file), source);
  }
  const workers = {before: nativeWorker(baseline), after: nativeWorker(resolve(root, 'backend/dist/windows'))};
  const samples = {before: [], after: []};
  try {
    const refs = {};
    for (const [mode, worker] of Object.entries(workers)) {
      const snapshot = await worker.request({action: 'get_ui', window_id: windowId, query: 'Editable field'});
      assert.equal(snapshot.nodes.length, 1);
      refs[mode] = {snapshot: snapshot.snapshot, element_id: snapshot.nodes[0].id};
      const text = 'warmup ' + mode;
      await worker.request({action: 'set_value', ...refs[mode], text});
      await waitFor(fixture.state, state => state.text === text, 'Benchmark warmup did not change the owned field.');
    }
    for (let index = 0; index < 7; index++) {
      for (const mode of index % 2 ? ['after', 'before'] : ['before', 'after']) {
        const text = 'verified ' + mode + ' ' + index;
        const started = performance.now();
        await workers[mode].request({action: 'set_value', ...refs[mode], text});
        samples[mode].push(performance.now() - started);
        await waitFor(fixture.state, state => state.text === text, 'Benchmark action was not independently verified.');
      }
    }
    const summary = values => {
      const sorted = [...values].sort((a, b) => a - b);
      return {min_ms: sorted[0], median_ms: sorted[3], max_ms: sorted.at(-1)};
    };
    const hashes = {};
    for (const file of ['uia-worker.cs', 'uia-identity.cs', 'uia-observation.cs', 'uia-coordination.cs', 'excel-worker.cs', 'uia-worker.ps1', 'uia-worker.dll']) {
      hashes[file] = createHash('sha256').update(await readFile(resolve(root, 'backend/dist/windows', file))).digest('hex');
    }
    const report = {
      created_at: new Date().toISOString(), baseline_commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
      scenario: 'native ValuePattern.SetValue on one owned WinForms field in a fixture with 30 unrelated fields', runs: 7, independently_verified: 16,
      timing_scope: 'Warm native worker request/response; independent field verification, startup, and warmup excluded. No model, MCP, or companion latency included.',
      before: {...summary(samples.before), samples_ms: samples.before}, after: {...summary(samples.after), samples_ms: samples.after}, artifact_sha256: hashes,
    };
    await mkdir(dirname(output), {recursive: true});
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log('Native identity latency (min/median/max ms):', report.before, report.after);
  } finally {for (const worker of Object.values(workers)) worker.close();}
}
