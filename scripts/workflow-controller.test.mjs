import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileJobStore, runWorkflow, validateRequest, timingSummary} from './workflow-controller.mjs';
import {GitHubWorkflowAdapter} from './github-workflow-adapter.mjs';

const request = {kind: 'github_pr_merge', repository: 'fixture/project', head: 'improvement', base: 'main', head_sha: 'a'.repeat(40), title: 'Improve latency', body: 'Reviewed content', authorization: {create_pr: true, merge: true}, poll_ms: 10, timeout_ms: 1000};
function fixture() {
  let saved = null, clock = 10000, locked = false;
  const calls = [];
  const pr = {number: 7, url: 'https://github.com/fixture/project/pull/7', repository: request.repository, head_repository: request.repository,
    head: request.head, base: request.base, head_sha: request.head_sha, title: request.title, body: request.body, draft: false, state: 'open', merged: false, merge_sha: null, mergeable: true, mergeable_state: 'clean'};
  let created = false;
  const store = {async acquire() {assert(!locked); locked = true;}, async release() {locked = false;},
    async get() {return structuredClone(saved);}, async put(value) {saved = structuredClone(value);}};
  const adapter = {
    async verifyHead() {calls.push('head');},
    async findPR() {calls.push('find'); return created ? [structuredClone(pr)] : [];},
    async createPR() {calls.push('create'); assert.equal(saved.mutations.create.status, 'uncertain'); created = true; return structuredClone(pr);},
    async getPR() {calls.push('read'); return structuredClone(pr);},
    async checks() {calls.push('checks'); return [{name: 'CI', state: 'passed'}];},
    async mergePR() {calls.push('merge'); assert.equal(saved.mutations.merge.status, 'uncertain'); pr.merged = true; pr.state = 'closed'; pr.merge_sha = 'b'.repeat(40);},
    async verifyBase() {calls.push('base');},
  };
  const options = {adapter, store, now: () => clock, monotonic: () => clock, sleep: async ms => {clock += ms;}};
  return {adapter, store, calls, pr, options, saved: () => saved, advance: ms => {clock += ms;}, run: () => runWorkflow(request, options)};
}

test('authorized full workflow automatically verifies and records after CI', async () => {
  const f = fixture(); let checks = 0;
  f.adapter.checks = async () => [{name: 'CI', state: checks++ ? 'passed' : 'pending'}];
  const job = await f.run();
  assert.equal(job.status, 'complete'); assert(job.recorded_at); assert.equal(job.merge_sha, 'b'.repeat(40));
  assert(job.request_to_recorded_ms >= job.request_to_verified_ms);
  assert.equal(job.events.filter(event => event.category === 'poll_wait').length, 1);
  assert.equal(job.mutations.merge.status, 'observed');
  assert.equal((await f.store.get()).recorded_at, job.recorded_at);
  const count = f.calls.length; await f.run(); assert.equal(f.calls.length, count);
});

test('uncertain delivered create reconciles on restart and is never replayed', async () => {
  const f = fixture(), create = f.adapter.createPR;
  f.adapter.createPR = async () => {await create(); throw new Error('Connection lost after delivery');};
  assert.equal((await f.run()).status, 'attention');
  assert.equal((await f.run()).status, 'complete');
  assert.equal(f.calls.filter(call => call === 'create').length, 1);
  assert.equal(f.saved().runs.length, 2);
  assert(f.saved().events.some(event => event.error?.includes('Connection lost')));
});

test('uncertain undelivered create remains attention rather than retrying', async () => {
  const f = fixture(); let count = 0;
  f.adapter.createPR = async () => {count++; throw new Error('Delivery unknown');};
  await f.run(); const job = await f.run();
  assert.equal(count, 1); assert.equal(job.status, 'attention'); assert.match(job.error, /No replay/);
});

test('uncertain delivered merge reconciles and verifies base on restart', async () => {
  const f = fixture(), merge = f.adapter.mergePR;
  f.adapter.mergePR = async () => {await merge(); throw new Error('Merge response lost');};
  assert.equal((await f.run()).status, 'attention');
  const resumed = await f.run(); assert.equal(resumed.status, 'complete');
  assert.equal(resumed.mutations.merge.status, 'observed');
  assert.equal(f.calls.filter(call => call === 'merge').length, 1);
});

test('unconfirmed merge is not replayed even when CI stays green', async () => {
  const f = fixture(); let count = 0;
  f.adapter.mergePR = async () => {count++; throw new Error('Delivery unknown');};
  await f.run(); const job = await f.run();
  assert.equal(count, 1); assert.equal(job.status, 'attention'); assert.match(job.error, /No replay/);
});

test('CI failure, missing evidence, unknown state, and conflicts stop before merge', async () => {
  for (const scenario of ['failed', 'missing', 'unknown', 'conflict']) {
    const f = fixture();
    f.adapter.checks = async () => scenario === 'missing' ? [] : [{name: 'CI', state: scenario === 'conflict' ? 'passed' : scenario}];
    if (scenario === 'conflict') f.pr.mergeable = false;
    const job = await f.run(); assert.equal(job.status, scenario === 'missing' ? 'timed_out' : 'attention'); assert(!job.recorded_at);
    assert(!f.calls.includes('merge')); assert(!f.saved().mutations.merge);
  }
});

test('changed repository, head, base, number, closed state or draft stops mutation', async () => {
  for (const patch of [{repository: 'other/project'}, {head_repository: 'fork/project'}, {head_sha: 'c'.repeat(40)}, {base: 'release'}, {draft: true}, {state: 'closed'}, {mergeable_state: 'blocked'}, {mergeable_state: 'behind'}]) {
    const f = fixture(); Object.assign(f.pr, patch);
    assert.equal((await f.run()).status, 'attention'); assert(!f.calls.includes('merge'));
  }
  const f = fixture(), read = f.adapter.getPR; let count = 0;
  f.adapter.getPR = async () => ({...await read(), ...(count++ ? {number: 8} : {})});
  assert.equal((await f.run()).status, 'attention'); assert(!f.calls.includes('merge'));
});

test('head changed during CI is rejected immediately before merge', async () => {
  const f = fixture(); f.adapter.checks = async () => {f.pr.head_sha = 'd'.repeat(40); return [{name: 'CI', state: 'passed'}];};
  const job = await f.run(); assert.equal(job.status, 'attention'); assert(!f.calls.includes('merge'));
});

test('read failure before dispatch can resume safely; authorization changes cannot', async () => {
  const f = fixture(), verify = f.adapter.verifyHead;
  f.adapter.verifyHead = async () => {throw new Error('GitHub rate limited (429)');};
  assert.equal((await f.run()).status, 'attention'); assert(!f.calls.includes('create'));
  f.adapter.verifyHead = verify;
  await assert.rejects(runWorkflow({...request, head: 'different'}, f.options), /differs/);
  assert.equal((await f.run()).status, 'complete');
});

test('pause, cancellation and deadline leave a resumable journal with no merge', async () => {
  for (const reason of ['pause', 'cancel']) {
    const f = fixture(), controller = new AbortController(); f.options.signal = controller.signal;
    f.adapter.checks = async () => {controller.abort(reason); return [{name: 'CI', state: 'pending'}];};
    const job = await f.run(); assert.equal(job.status, reason === 'pause' ? 'paused' : 'cancelled'); assert(!f.calls.includes('merge'));
  }
  const f = fixture(); f.adapter.checks = async () => [{name: 'CI', state: 'pending'}];
  const job = await f.run(); assert.equal(job.status, 'timed_out'); assert.equal(job.total_elapsed_ms, 1000); assert(!job.recorded_at);
});

test('base verification failure never records successful completion', async () => {
  const f = fixture(); f.adapter.verifyBase = async () => {throw new Error('Base was rewritten');};
  const job = await f.run(); assert.equal(job.status, 'attention'); assert(!job.verified_at); assert(!job.recorded_at);
  assert(!f.saved().recorded_at);
});

test('independent readiness reads start concurrently and both settle before any write', async () => {
  const f = fixture(); let release, secondStarted = false;
  f.adapter.verifyHead = () => new Promise(resolve => {release = resolve;});
  f.adapter.findPR = async () => {secondStarted = true; release(); return [];};
  assert.equal((await f.run()).status, 'complete'); assert(secondStarted);
});

test('authorization and pinned-target validation happen before acquisition', async () => {
  const f = fixture(); f.store.acquire = async () => {throw new Error('Must not open store');};
  await assert.rejects(runWorkflow({...request, authorization: {create_pr: true, merge: false}}, f.options), /authorization/);
  for (const patch of [{head_sha: 'main'}, {repository: '../secret'}, {poll_ms: 0}, {head: 'main'}]) assert.throws(() => validateRequest({...request, ...patch}));
});

test('disk store excludes concurrent owners, rejects corruption, and preserves prior journal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pokemon-job-test-'));
  try {
    const path = join(directory, 'job.json'), first = new FileJobStore(path), second = new FileJobStore(path);
    await first.acquire(); await assert.rejects(second.acquire(), /locked/);
    await first.put({status: 'first'}); await first.put({status: 'second'});
    assert.equal((await first.get()).status, 'second'); await first.release();
    await second.acquire(); await second.release();
    await writeFile(path, '{invalid'); await assert.rejects(second.get());
    assert.equal(await readFile(path, 'utf8'), '{invalid');
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('GitHub adapter pins merge SHA, sends one mutation on HTTP error, and recognizes CI', async () => {
  const calls = []; const adapter = new GitHubWorkflowAdapter({token: 'fixture-token', fetch: async (url, options) => {
    calls.push({url, options}); return {ok: false, status: 429};
  }});
  await assert.rejects(adapter.mergePR(request, 7), /429/); assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].options.body), {sha: request.head_sha, merge_method: 'squash'});
  assert.equal(adapter.conclusion('waiting', null), 'pending'); assert.equal(adapter.conclusion('completed', 'failure'), 'failed');
  assert.equal(adapter.conclusion('completed', 'success'), 'passed'); assert.equal(adapter.conclusion('mystery', null), 'unknown');
});

test('overlapping read spans are unioned and initial CI scheduling gaps can recover', async () => {
  const summary = timingSummary({total_elapsed_ms: 20, runs: [], events: [
    {category: 'api', started_at: new Date(0).toISOString(), elapsed_ms: 10},
    {category: 'api', started_at: new Date(5).toISOString(), elapsed_ms: 10},
  ]});
  assert.equal(summary.api_span_union_ms, 15); assert.equal(summary.unclassified_gap_ms, 5);
  const f = fixture(); let count = 0;
  f.adapter.checks = async () => count++ ? [{name: 'CI', state: 'passed'}] : [];
  assert.equal((await f.run()).status, 'complete');
});

test('hard-crash journal preserves elapsed time when no final checkpoint exists', async () => {
  const f = fixture(); let interrupted;
  const originalPut = f.store.put;
  f.store.put = async job => {
    await originalPut(job);
    if (job.phase === 'wait_ci' && !interrupted) interrupted = structuredClone(job);
  };
  await f.run();
  assert(interrupted && !interrupted.runs[0].finished_at && interrupted.total_elapsed_ms === undefined);
  // Restore the last durable checkpoint as if the first process disappeared.
  await originalPut(interrupted); f.advance(500);
  const recovered = await f.run();
  assert.equal(recovered.status, 'complete'); assert(recovered.request_to_recorded_ms >= 500);
  assert.equal(recovered.runs.at(-1).previous_run_interrupted, true);
  assert.equal(f.calls.filter(call => call === 'create').length, 1);
  assert.equal(f.calls.filter(call => call === 'merge').length, 1);
});
