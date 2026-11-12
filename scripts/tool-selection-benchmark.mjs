import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {createHash, randomBytes, randomInt, randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import http from 'node:http';
import {cpus, release, tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {Client} from '../backend/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {InMemoryTransport} from '../backend/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import {createServer} from '../backend/dist/index.js';
import {PokemonRuntime} from '../backend/dist/pokemon/runtime.js';
import {LocalLearning} from '../backend/dist/learning/service.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2], connection = process.argv[3];
if (mode !== 'serve') {
  assert(connection, 'Pass the connection file printed by serve.');
  const started_at = new Date().toISOString(), {url, token} = JSON.parse(await readFile(connection, 'utf8'));
  const body = mode === 'call' ? JSON.parse(process.argv[4]) : {command: mode};
  const start = performance.now();
  const response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token}, body: JSON.stringify({...body, client_started_at: started_at})});
  const result = await response.json();
  assert(response.ok, JSON.stringify(result));
  console.log(JSON.stringify({client_http_ms: performance.now() - start, ...result}));
  process.exit(0);
}
assert.equal(process.platform, 'win32');
const baselineArg = process.argv.indexOf('--baseline');
assert(baselineArg >= 0 && process.argv[baselineArg + 1], 'Pass --baseline <saved project root>.');
const baseline = resolve(process.argv[baselineArg + 1]);
const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-tool-selection-'));
const output = resolve(root, 'benchmarks/results/tool-selection-2026-11-12.json');
const token = randomBytes(32).toString('hex'), learning = new LocalLearning(resolve(scratch, 'learning'), randomBytes(32));
const companion = {state: {pet: 'pikachu', activity: 'idle', message: '', task: '', visible: false, paused: false, completedActions: 0}, start: async () => {}, update: async function(patch) {Object.assign(this.state, patch);}, close: async () => {}};
const runtime = new PokemonRuntime(companion, undefined, learning), server = createServer(runtime), client = new Client({name: 'tool-selection-benchmark', version: '1'});
const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
const report = {created_at: new Date().toISOString(), environment: {cpu: cpus()[0].model, node: process.version, os: release()}, client: 'Active Codex agent selecting calls interactively via CLI -> loopback controller -> actual MCP client/server -> native UIA. Model ID/token counters unavailable.', contract: {}, trials: [], limits: ['Synthetic owned branching WinForms fixture, not unconstrained tasks in arbitrary applications.', 'Client gaps include active-agent deliberation, tool rendering, CLI startup and transport; they are not isolated model inference. Native/server time is measured separately.', 'Atomic vs fused is a controlled orchestration comparison using existing batch capability; it does not prove shorter instructions make a model faster.', 'Two unknown-until-observed instructions per trial, three action kinds. Final fixture state independently verifies completion and wrong actions.', 'In-memory MCP transport isolates server/native work; loopback HTTP and CLI bridge are additional benchmark overhead, not production stdio latency.', 'Test key and no overlay isolate execution and journal overhead; no real user data or satisfaction labels.']};
const traces = [], native = [], originalWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = function(chunk, ...args) {
  const line = String(chunk);
  for (const [prefix, rows] of [['[pokemon-client-timing] ', traces], ['[pokemon-timing] ', native]]) {
    if (line.startsWith(prefix)) { rows.push(JSON.parse(line.slice(prefix.length))); return true; }
  }
  return originalWrite(chunk, ...args);
};
process.env.POKEMON_TIMING = '1';
let fixture, current, trial = 0, pairStages;
const readState = async () => {
  try {throw new Error(await readFile(resolve(current.directory, 'failure.txt'), 'utf8'));}
  catch (error) {if (error.code !== 'ENOENT') throw error;}
  try {return JSON.parse(await readFile(resolve(current.directory, 'state.json'), 'utf8'));}
  catch (error) {if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}; throw error;}
};
async function waitState(accept) {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {const value = await readState(); if (accept(value)) return value; await delay(20);}
  throw new Error('Owned fixture did not reach its expected state.');
}
const decode = result => JSON.parse(result.content.filter(x => x.type === 'text').map(x => x.text).join('\n'));
async function api(name, args) {
  const start = performance.now(), result = await client.callTool({name, arguments: args});
  return {data: decode(result), isError: result.isError === true, mcp_ms: performance.now() - start};
}
async function nextTrial() {
  if (current) {
    const state = await waitState(x => x.complete === true);
    assert.equal(state.correct, 2); assert.equal(state.wrong, 0);
    current.finished_at = new Date().toISOString(); current.verified_state = state;
    current.traces = traces.filter(x => x.task_id === current.task_id);
    await api('learning', {action: 'finish', task_id: current.task_id, outcome: 'met', summary: 'Independent owned-fixture state verified two current instructions; no satisfaction inferred.'});
    await writeFile(resolve(current.directory, 'quit'), 'quit');
    await new Promise(resolveExit => fixture.once('exit', resolveExit));
  }
  if (trial === 4) return {done: true, trials: 4, instruction: 'All trials verified. Call finish to write the report and close owned resources.'};
  const arm = ['atomic', 'fused', 'fused', 'atomic'][trial];
  if (trial % 2 === 0) {
    const kinds = trial === 0 ? ['edit', 'button'] : ['toggle', 'button'];
    for (let i = kinds.length - 1; i > 0; i--) {const j = randomInt(i + 1); [kinds[i], kinds[j]] = [kinds[j], kinds[i]];}
    pairStages = kinds.map((kind, i) => {
      const name = 'Task ' + ['Cedar', 'Harbor', 'Maple'][i] + ' ' + randomInt(100, 999);
      const value = kind === 'edit' ? 'code-' + randomInt(10000, 99999) : kind === 'toggle' ? 'on' : 'pressed';
      const instruction = kind === 'edit' ? `Task stage ${i + 1}: Write ${value} into ${name}.` : kind === 'toggle' ? `Task stage ${i + 1}: Enable the ${name} option.` : `Task stage ${i + 1}: Press ${name}.`;
      return {kind, name, value, instruction};
    });
  }
  const directory = resolve(scratch, 'trial-' + trial); await mkdir(directory);
  await writeFile(resolve(directory, 'fixture.json'), JSON.stringify({stages: pairStages}));
  current = {index: trial++, arm, directory, calls: [], started_at: new Date().toISOString(), stages: pairStages};
  const title = 'Tool Selection Fixture ' + randomUUID().slice(0, 8);
  fixture = spawn(resolve(scratch, 'fixture.exe'), [directory, title], {windowsHide: true, stdio: 'ignore'});
  const state = await waitState(x => x.stage === 0 && x.window_id);
  const task = await api('learning', {action: 'begin', query: 'Fulfill each currently displayed instruction in the owned Tool Selection Fixture, observing each result before choosing the next action.', parameters: {window: title}});
  current.task_id = task.data.task_id;
  const windows = await api('windows', {action: 'get_windows', query: title, task_id: current.task_id});
  assert.equal(windows.data.windows.length, 1);
  current.window = windows.data.windows[0]; assert.equal(current.window.id, state.window_id);
  const observed = await api('windows', {action: 'get_ui', window_id: current.window.id, window_ref: current.window.window_ref, task_id: current.task_id, query: 'Task', max_chars: 4000});
  report.trials.push(current);
  return {trial: current.index, arm, window: current.window, task_id: current.task_id, observation: observed.data, policy: arm === 'atomic' ? 'Choose one atomic Windows action from the current instruction and observed control; then issue a separate get_ui to verify and obtain the next instruction.' : 'Choose the action from the current instruction and observed control, and batch it with get_ui in the same call. The next action must be chosen only after reading the returned observation.'};
}
try {
  const compile = resolve(scratch, 'compile.ps1');
  await writeFile(compile, 'param($source,$output)\n$ErrorActionPreference="Stop"\nAdd-Type -Path $source -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions -OutputAssembly $output -OutputType WindowsApplication\n');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', compile, resolve(root, 'scripts/tool-selection-fixture.cs'), resolve(scratch, 'fixture.exe')], {windowsHide: true, stdio: 'inherit'});
  await server.connect(serverTransport); await client.connect(clientTransport);
  for (const [arm, project] of [['before', baseline], ['after', root]]) {
    const {createServer: factory} = await import(pathToFileURL(resolve(project, 'backend/dist/index.js')).href);
    const temporaryServer = factory(runtime), probe = new Client({name: 'contract-probe', version: '1'}), [a, b] = InMemoryTransport.createLinkedPair();
    await temporaryServer.connect(a); await probe.connect(b);
    const tools = (await probe.listTools()).tools, instructions = probe.getInstructions();
    report.contract[arm] = {instructions_chars: instructions.length, instructions_utf8_bytes: Buffer.byteLength(instructions), tools_utf8_bytes: Buffer.byteLength(JSON.stringify(tools)), tools: tools.map(x => ({name: x.name, description_chars: x.description.length, schema_utf8_bytes: Buffer.byteLength(JSON.stringify(x.inputSchema))})), expanded_descriptions_chars: tools.reduce((n, x) => n + x.description.length + instructions.length, 0)};
    await probe.close(); await temporaryServer.close();
  }
  report.hashes = {};
  for (const file of ['index.js', 'learning/instructions.js', 'learning/instrument.js', 'tools/windows.js', 'utils/client-timing.js', 'windows/uia-worker.dll']) report.hashes[file] = createHash('sha256').update(await readFile(resolve(root, 'backend/dist', file))).digest('hex');
  const listener = http.createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, 'Bearer ' + token);
      let text = ''; for await (const chunk of req) {text += chunk; assert(text.length < 20000);}
      const input = JSON.parse(text);
      let result;
      if (input.command === 'abort') {
        fixture?.kill(); listener.close(); await client.close(); await runtime.close();
        result = {aborted: true};
      } else if (input.command === 'next') result = await nextTrial();
      else if (input.command === 'refresh') {
        const discovered = await api('windows', {action: 'get_windows', query: current.window.title, task_id: current.task_id});
        assert.equal(discovered.data.windows.length, 1); assert.equal(discovered.data.windows[0].id, current.window.id);
        current.window = discovered.data.windows[0];
        const observed = await api('windows', {action: 'get_ui', window_id: current.window.id, window_ref: current.window.window_ref, query: 'Task', max_chars: 4000, task_id: current.task_id});
        result = {window: current.window, observation: observed.data, instruction: 'Fresh discovery; no inputs replayed.'};
      }
      else if (input.command === 'finish') {
        assert.equal(trial, 4); assert(current.verified_state?.complete);
        report.native_spans = native; report.client_traces = traces;
        await mkdir(dirname(output), {recursive: true}); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
        result = {saved: output, verified_trials: report.trials.length};
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
        listener.close(); await client.close(); await server.close(); await runtime.close();
        process.stderr.write = originalWrite;
        const checked = await realpath(scratch); assert.equal(dirname(checked).toLowerCase(), (await realpath(tmpdir())).toLowerCase()); assert(checked.split(/[\\/]/).at(-1).startsWith('pokemon-tool-selection-'));
        await rm(checked, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
        return;
      } else {
        assert(current && !current.verified_state);
        const args = input;
        const client_started_at = input.client_started_at;
        delete args.client_started_at;
        const steps = args.steps || [args];
        assert.equal(current.arm === 'fused', Array.isArray(args.steps), 'Follow this trial’s atomic/fused policy.');
        for (const step of steps) {assert(['get_ui', 'set_value', 'toggle', 'invoke'].includes(step.action)); assert.equal(step.window_id, current.window.id); assert.equal(step.window_ref, current.window.window_ref);}
        const before = await readState(), start = performance.now(), submitted_at = new Date().toISOString();
        result = await api('windows', {...args, task_id: current.task_id});
        const mutates = steps.some(step => step.action !== 'get_ui');
        const after = await waitState(x => x.stage >= before.stage + (mutates && !result.isError ? 1 : 0));
        current.calls.push({submitted_at, client_started_at, elapsed_ms: performance.now() - start, mcp_ms: result.mcp_ms, args, isError: result.isError, before_stage: before.stage, after_stage: after.stage, response_utf8_bytes: Buffer.byteLength(JSON.stringify(result.data))});
        result = {trial: current.index, arm: current.arm, ...result};
      }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
    } catch (error) {res.statusCode = 400; res.end(JSON.stringify({error: error.message}));}
  });
  await new Promise(resolveListen => listener.listen(0, '127.0.0.1', resolveListen));
  const file = resolve(scratch, 'connection.json'); await writeFile(file, JSON.stringify({url: `http://127.0.0.1:${listener.address().port}`, token}));
  console.log(JSON.stringify({connection: file, instruction: 'Call next to begin. Select actions only from returned native UI observations; do not read fixture.json or future stages. Four two-step trials use ABBA atomic/fused ordering.'}));
} catch (error) {fixture?.kill(); await client.close(); await runtime.close(); throw error;}
