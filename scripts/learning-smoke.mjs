import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir, cpus} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {connect} from './client.mjs';

assert.equal(process.platform, 'win32');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-learning-native-'));
const learningDirectory = resolve(scratch, 'learning');
const title = 'Learning Fixture ' + randomUUID().slice(0, 8);
const query = 'Enter a note and verify the test button';
const samples = [];
let session, fixture, clicks = 0;

const decode = result => JSON.parse(result.content.find(item => item.type === 'text').text);
async function api(name, args) {
  const result = await session.client.callTool({name, arguments: args});
  assert(!result.isError, JSON.stringify(result));
  return decode(result);
}
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
  throw new Error('Native learning fixture did not reach the expected state.');
}
async function finish(id, outcome, feedback = true) {
  await api('learning', {action: 'finish', task_id: id, outcome, summary: 'Synthetic native fixture verification'});
  if (feedback) await api('learning', {action: 'feedback', task_id: id, satisfaction: 'satisfied'});
}
async function cold(text) {
  const task = await api('learning', {action: 'begin', query, parameters: {window: title, text}});
  const begin = performance.now();
  const windows = await api('windows', {action: 'get_windows', task_id: task.task_id, query: title});
  assert.equal(windows.windows.length, 1); assert(!windows.truncated);
  const window_id = windows.windows[0].id;
  const editor = await api('windows', {action: 'get_ui', task_id: task.task_id, window_id, query: 'Editable field', control_type: 'Edit'});
  assert.equal(editor.matched, 1);
  await api('windows', {action: 'set_value', task_id: task.task_id, snapshot: editor.snapshot, element_id: editor.nodes[0].id, text});
  const button = await api('windows', {action: 'get_ui', task_id: task.task_id, window_id, query: 'Original item', control_type: 'Button'});
  assert.equal(button.matched, 1);
  await api('windows', {action: 'invoke', task_id: task.task_id, snapshot: button.snapshot, element_id: button.nodes[0].id});
  const final = await api('windows', {action: 'get_ui', task_id: task.task_id, window_id, query: 'Editable field', control_type: 'Edit'});
  assert.equal(final.nodes[0].value, text); assert(!final.truncated);
  const elapsed_ms = performance.now() - begin;
  clicks++;
  await waitFor(state, value => value.text === text && value.clicks === clicks);
  await finish(task.task_id, 'met');
  samples.push({mode: 'atomic_recorded', elapsed_ms, mcp_workflow_calls: 6, independently_verified: true});
}
async function replay(text, fail = false) {
  const planning = performance.now();
  const task = await api('learning', {action: 'begin', query, parameters: {window: title, text}});
  const recipe = task.suggestions.find(item => item.kind === 'windows');
  assert(recipe, 'Atomic run did not produce a reusable Windows recipe.');
  const preview = await api('learning', {action: 'preview', task_id: task.task_id, recipe_id: recipe.recipe_id, parameters: {window: title, text}});
  const planning_ms = performance.now() - planning;
  assert.equal(preview.steps.length, 6);
  assert(!JSON.stringify(preview.steps).includes('snapshot'));
  const begin = performance.now();
  const result = await session.client.callTool({name: 'learning', arguments: {action: 'run', task_id: task.task_id, preview_id: preview.preview_id}});
  const elapsed_ms = performance.now() - begin;
  const data = decode(result);
  if (fail) {
    assert.equal(result.isError, true);
    assert.equal(data.completed, 4);
    assert.equal(data.stopped_step, 4);
    await waitFor(state, value => value.text === text && value.clicks === clicks);
    await finish(task.task_id, 'unmet', false);
    return {failure_observed: true, completed: data.completed, no_extra_click: true, satisfaction: 'unknown'};
  }
  assert(!result.isError, JSON.stringify(result)); assert.equal(data.completed, 6);
  assert.equal(data.result.nodes[0].value, text);
  clicks++;
  await waitFor(state, value => value.text === text && value.clicks === clicks);
  await finish(task.task_id, 'met');
  samples.push({mode: 'learned_replay', elapsed_ms, planning_ms, mcp_workflow_calls: 1, independently_verified: true});
}

try {
  const compile = resolve(scratch, 'compile.ps1');
  const executable = resolve(scratch, 'fixture.exe');
  await writeFile(compile, "param($source, $output)\n$ErrorActionPreference = 'Stop'\nAdd-Type -Path $source -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions -OutputAssembly $output -OutputType WindowsApplication\n");
  execFileSync(resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', compile, resolve(root, 'scripts/identity-fixture.cs'), executable], {windowsHide: true, stdio: 'inherit'});
  fixture = spawn(executable, [scratch, title], {windowsHide: true, stdio: 'ignore'});
  await waitFor(state, value => value.text === 'initial');
  const connectMs = performance.now();
  session = await connect({env: {...process.env, MCP_TRANSPORT: 'stdio', POKEMON_UI: 'off', POKEMON_LEARNING_DIR: learningDirectory}});
  const status = await api('desktop', {action: 'status'});
  assert(status.native.ready);
  const startup_ms = performance.now() - connectMs;
  const firstOpen = performance.now();
  await api('learning', {action: 'status'});
  const protected_store_open_ms = performance.now() - firstOpen;
  await cold('Native learning initial');
  await replay('Native learning reused');
  // Force a new server/worker, losing all native snapshots; learned data must survive.
  await session.client.close(); session = undefined;
  session = await connect({env: {...process.env, MCP_TRANSPORT: 'stdio', POKEMON_UI: 'off', POKEMON_LEARNING_DIR: learningDirectory}});
  assert((await api('desktop', {action: 'status'})).native.ready);
  for (let pair = 0; pair < 3; pair++) {
    if (pair % 2) {await replay('Native warm replay ' + pair); await cold('Native cold ' + pair);}
    else {await cold('Native cold ' + pair); await replay('Native warm replay ' + pair);}
  }
  await writeFile(resolve(scratch, 'command'), 'hide');
  await waitFor(state, value => value.sequence > 0);
  const failure = await replay('Partial application observed', true);
  const stats = await api('learning', {action: 'status'});
  assert.equal(stats.model.examples, 9);
  assert.equal(stats.recipes, 1);
  assert(stats.api_counts['windows.invoke'].failures >= 1);
  const encrypted = await readFile(resolve(learningDirectory, 'events.enc'), 'utf8');
  assert(!encrypted.includes(query)); assert(!encrypted.includes('Native learning'));
  assert((await readFile(resolve(learningDirectory, 'key'))).length > 32);
  const median = values => {const s = values.toSorted((a,b)=>a-b); return (s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2;};
  const summary = Object.fromEntries(['atomic_recorded','learned_replay'].map(mode=>[mode,{runs:samples.filter(x=>x.mode===mode).length,median_ms:median(samples.filter(x=>x.mode===mode).map(x=>x.elapsed_ms))}]));
  const report = {created_at:new Date().toISOString(), source_revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    environment:{cpu:cpus()[0].model,node:process.version}, startup_ms, protected_store_open_ms, summary, samples, failure, learning:stats,
    limits:['Synthetic owned WinForms tasks and explicit test ratings; not real user satisfaction.', 'MCP workflow call counts exclude begin, preview, finish and feedback; planning_ms includes begin and preview.', 'No model inference from an external AI was timed. No claim of general app speedup.', 'Overlay disabled to isolate backend/model cost. Genuine feedback UI still requires separate verification.']};
  await mkdir(resolve(root,'benchmarks/results'),{recursive:true});
  await writeFile(resolve(root,'benchmarks/results/local-learning-native-2026-11-11.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({startup_ms,protected_store_open_ms,summary,failure,model:stats.model,state_bytes:stats.state_bytes},null,2));
} finally {
  if (session) await session.client.close();
  if (fixture && fixture.exitCode === null && fixture.signalCode === null) await new Promise(done=>{fixture.once('exit',done);fixture.kill();});
  const checked = await realpath(scratch);
  assert.equal(dirname(checked).toLowerCase(),(await realpath(tmpdir())).toLowerCase());
  assert(checked.split(/[\\/]/).at(-1).startsWith('pokemon-learning-native-'));
  await rm(checked,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
