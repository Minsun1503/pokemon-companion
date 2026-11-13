import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdir, open, readFile, rename, unlink} from 'node:fs/promises';
import {dirname} from 'node:path';

export function validateRequest(request) {
  assert(request?.kind === 'github_pr_merge', 'kind must be github_pr_merge.');
  assert(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]+$/.test(request.repository) && !['.', '..'].includes(request.repository.split('/')[1]), 'Supply owner/repository.');
  assert(/^[a-f0-9]{40}$/.test(request.head_sha), 'Pin the full head_sha.');
  for (const key of ['head', 'base']) assert(typeof request[key] === 'string' && request[key].trim() && request[key].length <= 200 && !/[\s~^:?*\[\\]/.test(request[key]), `Invalid ${key} branch.`);
  assert(request.head !== request.base, 'Head and base must differ.');
  assert(typeof request.title === 'string' && request.title.trim() && request.title.length <= 256, 'Supply a bounded title.');
  assert(typeof request.body === 'string' && request.body.length <= 60000, 'Supply a bounded body.');
  assert(request.authorization?.create_pr === true && request.authorization?.merge === true, 'This workflow requires current create_pr and merge authorization.');
  if (request.pr_number !== undefined) assert(Number.isSafeInteger(request.pr_number) && request.pr_number > 0, 'Invalid pr_number.');
  const poll = request.poll_ms ?? 10000, timeout = request.timeout_ms ?? 1800000;
  assert(Number.isInteger(poll) && poll >= 10 && poll <= 60000, 'poll_ms must be 10–60000.');
  assert(Number.isInteger(timeout) && timeout >= poll && timeout <= 86400000, 'timeout_ms must be poll_ms–86400000.');
  return {...request, poll_ms: poll, timeout_ms: timeout};
}

/** Atomic local journal; a live owner prevents concurrent mutations of the same job. */
export class FileJobStore {
  constructor(path) {this.path = path;}
  async acquire() {
    await mkdir(dirname(this.path), {recursive: true});
    const lockPath = this.path + '.lock';
    try {this.lock = await open(lockPath, 'wx');}
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Never automatically reclaim a lock: PID reuse and lock replacement can race.
      throw new Error(`Job is locked. Verify its owner has exited before removing ${lockPath}.`);
    }
    try {await this.lock.writeFile(JSON.stringify({pid: process.pid, started_at: new Date().toISOString()}));}
    catch (error) {await this.release(); throw error;}
  }
  async get() {
    try {return JSON.parse(await readFile(this.path, 'utf8'));}
    catch (error) {if (error.code === 'ENOENT') return null; throw error;}
  }
  async put(value) {
    const temporary = this.path + '.' + randomUUID() + '.tmp';
    const file = await open(temporary, 'wx');
    try {await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync();}
    finally {await file.close();}
    await rename(temporary, this.path);
  }
  async release() {
    if (this.lock) {await this.lock.close(); this.lock = null; await unlink(this.path + '.lock');}
  }
}

const attention = message => Object.assign(new Error(message), {attention: true});
const signature = request => createHash('sha256').update(JSON.stringify(request)).digest('hex');

export function timingSummary(job) {
  const union = events => {
    const intervals = events.filter(event => Number.isFinite(event.elapsed_ms)).map(event => [Date.parse(event.started_at), Date.parse(event.started_at) + event.elapsed_ms]).sort((a, b) => a[0] - b[0]);
    let total = 0, end = -Infinity;
    for (const [start, finish] of intervals) {total += Math.max(0, finish - Math.max(start, end)); end = Math.max(end, finish);}
    return total;
  };
  const covered = union(job.events);
  return {api_span_union_ms: union(job.events.filter(event => event.category === 'api')),
    poll_sleep_union_ms: union(job.events.filter(event => event.category === 'poll_wait')), covered_union_ms: covered,
    unclassified_gap_ms: Math.max(0, job.total_elapsed_ms - covered),
    resume_gap_ms: job.runs.slice(1).reduce((sum, run, index) => sum + Math.max(0, Date.parse(run.started_at) - Date.parse(job.runs[index].finished_at ?? run.started_at)), 0),
    note: 'Intervals are unioned rather than summed. API spans include transport and server work; poll sleep is controller waiting, not GitHub CI runtime. Unclassified time includes journaling, scheduling and resume gaps. Host model inference is not instrumented.'};
}

/** Only read-only reconciliation is repeatable. A journaled mutation is never resent. */
export async function runWorkflow(request, {adapter, store, signal, now = () => Date.now(), monotonic = () => performance.now(), sleep = ms => delay(ms, undefined, {signal}), onProgress = () => {}}) {
  const received = now(), started = monotonic();
  request = validateRequest(request);
  await store.acquire();
  let job, run;
  const elapsed = () => (run?.prior_elapsed_ms ?? 0) + monotonic() - started;
  const iso = () => new Date(now()).toISOString();
  const save = () => store.put(job);
  const checkStop = () => {
    if (signal?.aborted) throw Object.assign(new Error('Workflow cancelled; inspect journal before resuming.'), {cancelled: true});
    if (now() >= job.deadline_ms) throw Object.assign(new Error('Workflow deadline reached.'), {timedOut: true});
  };
  const call = async (action, operation, category = 'api') => {
    const entry = {action, category, run: job.runs.length, started_at: iso(), started_ms: monotonic() - started};
    job.events.push(entry);
    const began = monotonic();
    try {const value = await operation(); entry.ok = true; return value;}
    catch (error) {entry.ok = false; entry.error = error.message; throw error;}
    finally {entry.elapsed_ms = monotonic() - began; entry.finished_at = iso();}
  };
  const guard = pr => {
    if (!pr || pr.repository !== request.repository || pr.head_repository !== request.repository || pr.head !== request.head || pr.base !== request.base || pr.head_sha !== request.head_sha || (job.pr_number && pr.number !== job.pr_number)) throw attention('PR repository, branches, number or head commit changed.');
    if (pr.draft) throw attention('Draft PR cannot be merged by this workflow.');
    if (!pr.merged && pr.state !== 'open') throw attention('PR was closed without merging.');
    return pr;
  };
  const find = async () => {
    if (job.pr_number) return guard(await call('read_pr', () => adapter.getPR(request, job.pr_number)));
    const matches = await call('find_pr', () => adapter.findPR(request));
    if (matches.length > 1) throw attention('Multiple matching PRs; supply the exact pr_number in a new reviewed job.');
    if (!matches.length) return null;
    const pr = guard(matches[0]);
    if (pr.title !== request.title || pr.body !== request.body) throw attention('Existing PR content differs from this request; review it explicitly.');
    job.pr_number = pr.number; job.pr_url = pr.url;
    return pr;
  };
  const markMerged = async pr => {
    guard(pr);
    if (!pr.merged || !pr.merge_sha) throw attention('GitHub has not verified the merge. Mutation will not be replayed.');
    job.phase = 'record'; job.merge_sha = pr.merge_sha;
    // The merged commit must be reachable from the current base, including later base updates.
    await call('verify_base', () => adapter.verifyBase(request, pr.merge_sha));
    job.status = 'complete'; job.verified_at = iso();
    job.request_to_verified_ms = elapsed();
    if (job.mutations.merge) job.mutations.merge.status = 'observed';
    await save();
    job.recorded_at = iso();
    job.request_to_recorded_ms = elapsed();
  };
  try {
    job = await store.get();
    if (job) {
      assert(job.schema_version === 1 && job.request_signature === signature(request), 'Request differs from the journal. Review a new job instead of changing authorization/target.');
      if (job.status === 'complete' && job.recorded_at) return job;
      // Failures stay visible. Resume retries reads, never a dispatched mutation.
    } else {
      job = {schema_version: 1, id: randomUUID(), kind: request.kind, request_signature: signature(request),
        repository: request.repository, head_sha: request.head_sha, received_ms: received, received_at: new Date(received).toISOString(),
        deadline_ms: received + request.timeout_ms, phase: 'prepare', status: 'running', events: [], runs: [], mutations: {},
        ...(request.pr_number ? {pr_number: request.pr_number} : {}),
        timing_boundary: 'Structured request accepted by controller to durable verified-merge record. Includes GitHub calls, polling and resume gaps. Excludes content preparation, host inference, module startup and report export. API spans include network/server time; CI poll sleeps are not CI runtime.'};
    }
    const lastRun = job.runs.at(-1);
    // After a hard crash there is no final monotonic checkpoint. Preserve the
    // original UTC boundary instead of dropping the interrupted run's duration.
    const priorElapsed = !lastRun ? 0 : !lastRun.finished_at || !Number.isFinite(job.total_elapsed_ms)
      ? Math.max(0, received - job.received_ms)
      : job.total_elapsed_ms + Math.max(0, received - Date.parse(job.last_finished_at));
    run = {started_at: iso(), prior_elapsed_ms: priorElapsed, previous_run_interrupted: Boolean(lastRun && !lastRun.finished_at)};
    job.runs.push(run); job.status = 'running'; delete job.error;
    await save(); checkStop();
    // Independent reads overlap; no desktop lease is held by this API controller.
    const ready = await Promise.allSettled([
      call('verify_head', () => adapter.verifyHead(request)),
      find(),
    ]);
    for (const result of ready) if (result.status === 'rejected') throw result.reason;
    let pr = ready[1].value;
    checkStop();
    if (!pr) {
      if (job.mutations.create) throw attention('Create delivery is uncertain and no matching PR was found. No replay sent.');
      job.phase = 'create'; job.mutations.create = {dispatched_at: iso(), status: 'uncertain'};
      await save(); checkStop();
      // An exception leaves the dispatch marker durable for next-run reconciliation.
      pr = guard(await call('create_pr', () => adapter.createPR(request)));
      job.pr_number = pr.number; job.pr_url = pr.url; job.mutations.create.status = 'observed';
      await save();
    }
    job.pr_url ??= pr.url;
    if (job.mutations.create && pr) job.mutations.create.status = 'observed';
    if (pr.merged) {await markMerged(pr);}
    else {
      if (job.mutations.merge) throw attention('Merge delivery is uncertain and PR is still unmerged. No replay sent.');
      job.phase = 'wait_ci'; await save();
      for (;;) {
        checkStop();
        pr = guard(await call('read_pr', () => adapter.getPR(request, job.pr_number)));
        if (pr.merged) {await markMerged(pr); break;}
        if (pr.mergeable === false) throw attention('PR has merge conflicts.');
        const checks = await call('read_checks', () => adapter.checks(request));
        job.last_check_count = checks.length;
        if (!checks.length) {
          job.ci_discovery_started_ms ??= now();
          if (now() - job.ci_discovery_started_ms >= 60000) throw attention('No CI evidence appeared for the pinned head within 60 seconds.');
        }
        const failed = checks.filter(check => check.state === 'failed');
        if (failed.length) throw attention('CI failed: ' + failed.map(check => check.name).join(', '));
        if (checks.some(check => !['passed', 'pending'].includes(check.state))) throw attention('Unknown CI state.');
        if (checks.length && checks.every(check => check.state === 'passed') && ['blocked', 'behind', 'dirty', 'unstable'].includes(pr.mergeable_state)) throw attention('GitHub merge requirements are not satisfied: ' + pr.mergeable_state);
        if (checks.length && checks.every(check => check.state === 'passed') && pr.mergeable === true && pr.mergeable_state === 'clean') {
          // Refresh identity immediately before delivery; GitHub also compares SHA atomically.
          pr = guard(await call('premerge_pr', () => adapter.getPR(request, job.pr_number)));
          if (pr.merged) {await markMerged(pr); break;}
          if (pr.mergeable !== true || pr.mergeable_state !== 'clean') throw attention('Merge readiness changed.');
          job.phase = 'merge'; job.mutations.merge = {dispatched_at: iso(), status: 'uncertain'};
          await save(); checkStop();
          await call('merge_pr', () => adapter.mergePR(request, job.pr_number));
          pr = guard(await call('verify_merge', () => adapter.getPR(request, job.pr_number)));
          await markMerged(pr); job.mutations.merge.status = 'observed'; break;
        }
        onProgress({id: job.id, phase: job.phase, pr_url: job.pr_url});
        await save();
        await call('poll_wait', () => sleep(Math.min(request.poll_ms, Math.max(0, job.deadline_ms - now()))), 'poll_wait');
      }
    }
    job.phase = 'complete';
  } catch (error) {
    if (!job || !run) throw error;
    job.status = signal?.aborted && signal.reason === 'pause' ? 'paused' : error.cancelled || signal?.aborted ? 'cancelled' : error.timedOut ? 'timed_out' : 'attention';
    job.error = error.message;
    // A failed base verification must never leave a success-shaped record.
    delete job.recorded_at; delete job.verified_at; delete job.request_to_verified_ms; delete job.request_to_recorded_ms;
  } finally {
    try {
      if (job && run) {
        run.finished_at = iso(); run.active_ms = monotonic() - started;
        job.last_finished_at = iso(); job.total_elapsed_ms = elapsed();
        job.timing_summary = timingSummary(job);
        await save();
      }
    } finally {await store.release();}
  }
  return job;
}
