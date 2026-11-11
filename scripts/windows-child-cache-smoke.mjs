import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {connect} from './client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-child-cache-'));
const title = 'Child Cache Fixture ' + randomUUID().slice(0, 8);
let session, fixture, checks = 0;
const rounds = process.argv.includes('--recreation-only') ? 0 : 50;
const state = async () => {
  try {return JSON.parse(await readFile(resolve(scratch, 'state.json'), 'utf8'));}
  catch (error) {if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}; throw error;}
};
async function waitFor(read, accept) {
  const deadline = performance.now() + 15000;
  while (performance.now() < deadline) {const value = await read(); if (accept(value)) return value; await delay(30);}
  throw new Error('Child-cache fixture did not reach expected state.');
}
async function command(text) {
  const before = await waitFor(state, x => typeof x.sequence === 'number');
  await writeFile(resolve(scratch, 'command'), text);
  return waitFor(state, x => x.sequence > before.sequence);
}
const call = args => session.client.callTool({name: 'windows', arguments: {...args, max_chars: 16000}});
async function api(args) {const result = await call(args); assert(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text);}
const reference = ui => ({snapshot: ui.snapshot, element_id: ui.nodes[0].id});
async function reject(args, expectedCode) {
  const result = await call(args);
  assert(result.isError, JSON.stringify(result));
  const error = JSON.parse(result.content[0].text);
  assert.equal(error.error_details.code, expectedCode);
  assert.equal(error.error_details.disposition.delivery, 'not_delivered');
  assert.equal((await waitFor(state, x => typeof x.clicks === 'number')).clicks, 1, 'An unintended button was invoked.');
  checks++;
}
try {
  const executable = resolve(scratch, 'fixture.exe'), compile = resolve(scratch, 'compile.ps1');
  await writeFile(compile, "param($source, $output)\n$ErrorActionPreference = 'Stop'\nAdd-Type -Path $source -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions -OutputAssembly $output -OutputType WindowsApplication\n");
  execFileSync(resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', compile, resolve(root, 'scripts/identity-fixture.cs'), executable], {windowsHide: true, stdio: 'inherit'});
  fixture = spawn(executable, [scratch, title], {windowsHide: true, stdio: 'ignore'});
  await waitFor(state, x => x.text === 'initial');
  const env = {...process.env, MCP_TRANSPORT: 'stdio', POKEMON_UI: 'off', POKEMON_LEARNING_DIR: resolve(scratch, 'learning')};
  delete env.POKEMON_UIA_CHILD_CACHE; // Verify the production default, not only the opt-in arm.
  session = await connect({env});
  let window_id = (await api({action: 'get_windows', query: title})).windows[0].id;
  const inspect = (max_depth = 24) => api({action: 'get_ui', window_id, query: 'Original item', control_type: 'Button', max_depth});
  let button = await inspect();
  assert.equal(button.nodes[0].targetable, true);
  await command('move');
  await api({action: 'invoke', ...reference(button)});
  await waitFor(state, x => x.clicks === 1);
  // 200 changed-state cases: each has a fresh prior observation and an
  // independent click counter. Rejected input is never retried automatically.
  for (let round = 0; round < rounds; round++) {
    for (const mutation of ['rename', 'hide', 'disable', 'twin']) {
      await command('reset-benchmark');
      button = await inspect(); assert.equal(button.nodes.length, 1); assert.equal(button.nodes[0].targetable, true);
      await command(mutation);
      await reject({action: 'invoke', ...reference(button)}, mutation === 'twin' ? 'AMBIGUOUS_TARGET' : mutation === 'disable' ? 'ACTION_NOT_SUPPORTED' : 'STALE_REF');
      if (mutation === 'twin' && round === 0) {
        const twins = await inspect(); assert.equal(twins.nodes.length, 2); assert(twins.nodes.every(x => !x.targetable));
        await reject({action: 'invoke', ...reference(twins)}, 'AMBIGUOUS_TARGET');
      }
    }
    if ((round + 1) % 10 === 0) console.log(`Verified ${4 * (round + 1)}/200 mutation cases`);
  }
  await command('reset-benchmark'); button = await inspect();
  const start = await command('delayed-rename');
  await waitFor(state, x => x.sequence > start.sequence && x.name === 'Replacement item');
  await reject({action: 'invoke', ...reference(button)}, 'STALE_REF');
  await command('reset-benchmark');
  const partial = await inspect(1); assert(!partial.complete); assert(!partial.nodes[0].targetable);
  await reject({action: 'invoke', ...reference(partial)}, 'INCOMPLETE_SNAPSHOT');
  button = await inspect();
  const recreated = await command('recreate-window');
  await reject({action: 'invoke', ...reference(button)}, 'STALE_REF');
  const listed = await api({action: 'get_windows', query: title});
  // WinForms may expose a same-title parking window during handle recreation.
  // Bind the independently known main HWND only after observing it in MCP.
  const main = listed.windows.filter(x => x.id === recreated.window_id);
  assert.equal(main.length, 1, JSON.stringify(listed)); window_id = main[0].id;
  assert.equal((await inspect()).nodes[0].targetable, true);
  const report = {created_at: new Date().toISOString(), changed_state_rejections: checks, repeated_matrix_cases: rounds * 4,
    wrong_target_actions: 0, allowed_moved_control_actions: 1, fixture: 'Owned WinForms',
    cases: [...(rounds ? ['rename', 'hidden', 'disabled', 'duplicate identity'] : []), 'delayed rename', 'incomplete depth', 'recreated window'],
    limits: ['Repeated synthetic cases exercise guards; they are not 200 independent real-world application samples.', 'Electron identity and subtree coverage is tested by windows-identity-smoke.mjs.']};
  await writeFile(resolve(root, 'benchmarks/results/windows-child-cache-' + (rounds ? 'safety' : 'recreation') + '-2026-11-11.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (session) await session.client.close();
  if (fixture && fixture.exitCode === null && fixture.signalCode === null) await new Promise(done => {fixture.once('exit', done); fixture.kill();});
  const checked = await realpath(scratch);
  assert.equal(dirname(checked).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
  assert(checked.split(/[\\/]/).at(-1).startsWith('pokemon-child-cache-'));
  await rm(checked, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
}
