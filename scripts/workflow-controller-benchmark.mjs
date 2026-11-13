import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {FileJobStore, runWorkflow} from './workflow-controller.mjs';
import {GitHubWorkflowAdapter} from './github-workflow-adapter.mjs';

const directory = await mkdtemp(join(tmpdir(), 'pokemon-workflow-benchmark-'));
const ciMs = 1000, handoffMs = 100, samples = [];
const request = {kind: 'github_pr_merge', repository: 'fixture/project', head: 'change', base: 'main', head_sha: 'a'.repeat(40), title: 'Owned fixture PR', body: 'No external writes', authorization: {create_pr: true, merge: true}, poll_ms: 100, timeout_ms: 10000};
let fixture;
const server = createServer(async (incoming, outgoing) => {
  let text = ''; for await (const chunk of incoming) text += chunk;
  const url = new URL(incoming.url, 'http://fixture'), path = url.pathname;
  const body = text ? JSON.parse(text) : null;
  fixture.http_calls++;
  const json = (value, status = 200) => {outgoing.writeHead(status, {'Content-Type': 'application/json'}); outgoing.end(JSON.stringify(value));};
  if (path.endsWith('/git/ref/heads/change')) return json({object: {sha: request.head_sha}});
  if (path.endsWith('/git/ref/heads/main')) return json({object: {sha: 'b'.repeat(40)}});
  if (path.includes('/compare/')) return json({status: 'identical'});
  if (path.endsWith('/pulls') && incoming.method === 'GET') return json(fixture.pr ? [fixture.pr] : []);
  if (path.endsWith('/pulls') && incoming.method === 'POST') {
    fixture.create_count++;
    fixture.ci_started = performance.now();
    fixture.pr = {number: 1, html_url: 'http://fixture/pull/1', head: {sha: request.head_sha, ref: request.head, repo: {full_name: request.repository}},
      base: {ref: request.base, repo: {full_name: request.repository}}, title: body.title, body: body.body, draft: false, state: 'open', merged: false, mergeable: true, mergeable_state: 'clean'};
    return json(fixture.pr, 201);
  }
  if (path.endsWith('/pulls/1') && incoming.method === 'GET') {
    if (fixture.scenario === 'changed_head' && performance.now() - fixture.ci_started >= ciMs) fixture.pr.head.sha = 'c'.repeat(40);
    return json({...fixture.pr, mergeable: fixture.scenario !== 'conflict'});
  }
  if (path.endsWith('/pulls/1/merge')) {
    fixture.merge_count++;
    if (body.sha !== fixture.pr.head.sha || performance.now() - fixture.ci_started < ciMs) return json({}, 409);
    fixture.pr.merged = true; fixture.pr.state = 'closed'; fixture.pr.merge_commit_sha = 'b'.repeat(40);
    // Simulate a response lost after the owned fixture applied the merge.
    if (fixture.scenario === 'lost_merge_response' && !fixture.lost) {fixture.lost = true; return json({}, 503);}
    return json({merged: true});
  }
  if (path.endsWith('/check-runs')) {
    const finished = performance.now() - fixture.ci_started >= ciMs;
    return json({check_runs: [{name: 'Owned CI', status: finished ? 'completed' : 'in_progress', conclusion: finished ? fixture.scenario === 'ci_failure' ? 'failure' : 'success' : null}]});
  }
  if (path.endsWith('/statuses')) return json([]);
  if (path.endsWith('/actions/runs')) return json({workflow_runs: []});
  return json({}, 404);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  // Counterbalance order. Baseline is a controlled handoff-delay simulation, not an LLM.
  for (let pair = 0; pair < 20; pair++) {
    for (const mode of pair % 2 ? ['controller', 'handoff_simulation'] : ['handoff_simulation', 'controller']) {
      await measure(mode, 'success', pair);
    }
    if ((pair + 1) % 5 === 0) console.log(`Completed ${pair + 1}/20 matched fixture pairs`);
  }
  for (const scenario of ['ci_failure', 'conflict', 'changed_head', 'lost_merge_response']) {
    for (const mode of ['handoff_simulation', 'controller']) await measure(mode, scenario, 20);
  }
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
  const summary = Object.fromEntries(['handoff_simulation', 'controller'].map(mode => {
    const rows = samples.filter(row => row.mode === mode && row.scenario === 'success');
    return [mode, {successes: rows.filter(row => row.status === 'complete').length, samples: rows.length,
      verified_p50_ms: percentile(rows.map(row => row.request_to_verified_ms), .5), verified_p95_ms: percentile(rows.map(row => row.request_to_verified_ms), .95),
      recorded_p50_ms: percentile(rows.map(row => row.request_to_recorded_ms), .5), recorded_p95_ms: percentile(rows.map(row => row.request_to_recorded_ms), .95)}];
  }));
  const result = {schema_version: 1, recorded_at: new Date().toISOString(), boundary: 'Structured controller acceptance to durable verified record against an owned local HTTP GitHub fixture, including atomic disk journals and 1-second fixture CI. Both variants use identical controller/check/merge logic. Baseline injects 100ms after each adapter operation to simulate client handoffs; it does NOT measure a language model or natural-language request latency. HTTP connection reuse occurs in both variants. No GitHub PRs are created.', fixture_ci_ms: ciMs, simulated_handoff_ms: handoffMs, summary, samples};
  const output = resolve('benchmarks/results/workflow-controller-2026-11-13.json');
  await mkdir(resolve('benchmarks/results'), {recursive: true});
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  const lines = ['# Owned controller fixture comparison', '', result.boundary, '', '| Variant | Success | Verified p50 / p95 ms | Recorded p50 / p95 ms |', '| --- | --- | --- | --- |'];
  for (const [mode, row] of Object.entries(summary)) lines.push(`| ${mode} | ${row.successes}/${row.samples} | ${row.verified_p50_ms.toFixed(0)} / ${row.verified_p95_ms.toFixed(0)} | ${row.recorded_p50_ms.toFixed(0)} / ${row.recorded_p95_ms.toFixed(0)} |`);
  lines.push('', 'All failure and recovery samples are retained in the JSON. CI failure, conflict and changed head must stop; a lost merge response must reconcile with exactly one merge dispatch. The comparison demonstrates removal of configured handoff waits and makes no claim about host inference speed. A separate live PR trace measures the actual GitHub workflow.', '');
  await writeFile(output.replace(/\.json$/, '.md'), lines.join('\n'));
  console.log(JSON.stringify({output, summary}));
} finally {await new Promise(resolve => server.close(resolve)); await rm(directory, {recursive: true, force: true});}

async function measure(mode, scenario, pair) {
  fixture = {scenario, http_calls: 0, create_count: 0, merge_count: 0};
  const native = new GitHubWorkflowAdapter({token: 'owned-fixture-token', fetch: (url, options) => fetch(url.replace('https://api.github.com', origin), options)});
  let simulatedWait = 0;
  const adapter = mode === 'controller' ? native : Object.fromEntries(['verifyHead', 'findPR', 'getPR', 'createPR', 'checks', 'mergePR', 'verifyBase'].map(name => [name, async (...args) => {
    try {return await native[name](...args);}
    finally {const start = performance.now(); await delay(handoffMs); simulatedWait += performance.now() - start;}
  }]));
  const store = new FileJobStore(join(directory, `${mode}-${scenario}-${pair}.json`));
  const options = {adapter, store};
  let job = await runWorkflow(request, options);
  const attempts = [{status: job.status, error: job.error}];
  if (scenario === 'lost_merge_response') {job = await runWorkflow(request, options); attempts.push({status: job.status, error: job.error});}
  assert.equal(fixture.create_count, 1);
  assert.equal(fixture.merge_count, ['success', 'lost_merge_response'].includes(scenario) ? 1 : 0);
  assert.equal(job.status, ['success', 'lost_merge_response'].includes(scenario) ? 'complete' : 'attention');
  samples.push({mode, scenario, pair, status: job.status, attempts, request_to_verified_ms: job.request_to_verified_ms, request_to_recorded_ms: job.request_to_recorded_ms,
    total_elapsed_ms: job.total_elapsed_ms, simulated_handoff_wait_sum_ms: simulatedWait, http_calls: fixture.http_calls, create_count: fixture.create_count, merge_count: fixture.merge_count, events: job.events, runs: job.runs});
}
