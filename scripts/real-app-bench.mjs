import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {connect} from './client.mjs';

const [outputName, app, query, field] = process.argv.slice(2);
assert(outputName && app && query && field, 'Pass output.json, app label, unique window query and unique Edit name.');
const output = resolve(outputName);
const timing = [];
const session = await connect({stderr: 'pipe', env: {...process.env, POKEMON_TIMING: '1'}});
let buffer = '', calls = 0;
session.transport.stderr.on('data', chunk => {
  buffer += chunk.toString();
  while (buffer.includes('\n')) {
    const end = buffer.indexOf('\n'), line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (line.startsWith('[pokemon-timing] ')) timing.push(JSON.parse(line.slice(17)));
  }
});
async function windows(args) {
  calls++;
  return JSON.parse((await session.call('windows', args)).content[0].text);
}
async function flush() {
  for (let tries = 0; timing.length < calls && tries < 100; tries++) await delay(5);
  assert.equal(timing.length, calls);
}
function distribution(values) {
  const sorted = values.toSorted((a,b) => a-b);
  return {median: (sorted[9] + sorted[10]) / 2, p95: sorted[18]};
}
const samples = [];
try {
  const found = await windows({action: 'get_windows', query});
  assert.equal(found.windows.length, 1);
  assert.notEqual(found.truncated, true);
  const window_id = found.windows[0].id;
  await windows({action: 'activate', window_id});
  const edit = () => windows({action: 'get_ui', window_id, query: field, control_type: 'Edit', max_chars: 6000});
  const original = await edit();
  assert.equal(original.nodes.length, 1);
  assert(original.nodes[0].actions.includes('set_value'));
  assert.notEqual(original.nodes[0].value_clipped, true);
  const value = original.nodes[0].value;
  assert.equal(typeof value, 'string');
  assert(value.length <= 160, 'Use a short unchanged field for exact-value verification.');
  for (const scenario of ['get_windows', 'get_ui_narrow', 'get_ui_wide', 'set_value_verify', 'activate']) {
    for (let run = 1; run <= 20; run++) {
      const target = scenario === 'set_value_verify' ? await edit() : undefined;
      await flush();
      const startLog = timing.length, started = performance.now();
      let result;
      if (scenario === 'get_windows') result = await windows({action: scenario, query});
      if (scenario === 'get_ui_narrow') result = await edit();
      if (scenario === 'get_ui_wide') result = await windows({action: 'get_ui', window_id, max_elements: 250, max_chars: 16000});
      if (scenario === 'activate') result = await windows({action: scenario, window_id});
      if (target) {
        assert.equal(target.nodes.length, 1);
        assert.equal(target.nodes[0].value, value, 'Never replace unexpected user text.');
        const batch = await windows({action: 'batch', steps: [
          {action: 'set_value', snapshot: target.snapshot, element_id: target.nodes[0].id, text: value},
          {action: 'get_ui', window_id, query: field, control_type: 'Edit', expect_value: value},
        ], max_chars: 16000});
        assert.equal(batch.ok, true);
        result = batch.result;
      }
      const elapsed_ms = performance.now() - started;
      await flush();
      if (scenario === 'activate') assert.equal(result.ok, true);
      else if (scenario === 'get_windows') assert.equal(result.windows[0].id, window_id);
      else if (scenario !== 'get_ui_wide') {
        assert.equal(result.nodes.length, 1);
        assert.equal(result.nodes[0].value, value);
      } else assert(result.nodes.some(node => node.name === field));
      const logs = timing.slice(startLog), breakdown_ms = {};
      for (const call of logs) for (const [name, ms] of Object.entries(call.breakdown_ms)) breakdown_ms[name] = (breakdown_ms[name] || 0) + ms;
      samples.push({scenario, run, elapsed_ms, scanned: result.scanned ?? null, returned: result.nodes?.length ?? result.windows?.length ?? null, truncated: result.truncated ?? false, breakdown_ms, verified: true});
    }
    console.log('Verified ' + app + ' ' + scenario + ': 20/20');
  }
  const final = await edit();
  assert.equal(final.nodes[0].value, value);
  const summary = [...new Set(samples.map(s => s.scenario))].map(scenario => {
    const group = samples.filter(s => s.scenario === scenario);
    return {scenario, elapsed_ms: distribution(group.map(s => s.elapsed_ms)), scanned: group[0].scanned, returned: group[0].returned, truncated_runs: group.filter(s => s.truncated).length,
      breakdown_ms: Object.fromEntries([...new Set(group.flatMap(s => Object.keys(s.breakdown_ms)))].map(name => [name, distribution(group.map(s => s.breakdown_ms[name] || 0))]))};
  });
  await mkdir(dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify({complete: true, measured_at: new Date().toISOString(), app, query, field, unchanged_field_value: value, runs: 20, companion: 'on', timing_notes: 'uia_tree_walk includes property reads; serialization covers JSON only, excluding SDK framing. Nested spans overlap.', summary, samples}, null, 2) + '\n');
  console.table(summary.map(s => ({scenario: s.scenario, median: s.elapsed_ms.median.toFixed(1), p95: s.elapsed_ms.p95.toFixed(1), scanned: s.scanned, returned: s.returned, truncated: s.truncated_runs})));
} finally {await session.client.close();}
