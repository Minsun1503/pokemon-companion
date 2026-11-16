import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, sep} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {WindowsAutomation} from '../backend/dist/windows/automation.js';

const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-approval-guard-'));
const stateFile = resolve(scratch, 'state.json');
const title = 'Pokemon synthetic approval guard ' + Date.now();
const environment = {...process.env, POKEMON_FIXTURE_PROFILE: scratch, POKEMON_FIXTURE_STATE: stateFile, POKEMON_FIXTURE_TITLE: title, POKEMON_FIXTURE_CDP: 'off'};
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(resolve('frontend/node_modules/electron/dist/electron.exe'), [resolve('scripts/app-adapter-fixture.cjs')], {env: environment, windowsHide: true, stdio: 'ignore'});
const native = new WindowsAutomation();
let state;
try {
  for (let index = 0; index < 100; index++) {try {state = JSON.parse(await readFile(stateFile, 'utf8')); break;} catch {await delay(100);}}
  assert(state);
  const listed = await native.request({action: 'get_windows', query: title});
  assert.equal(listed.windows.length, 1);
  const selected = {window_id: listed.windows[0].id, window_ref: listed.windows[0].window_ref};
  const observed = await native.request({action: 'get_ui', ...selected, query: 'Refresh'});
  const button = observed.nodes.find(node => node.name === 'Refresh');
  assert(button);
  await native.request({action: 'protect_companion', text: JSON.stringify({window_id: selected.window_id, process_id: state.pid, approval: 1})});
  for (const action of ['get_ui', 'app_identity', 'cdp_ports', 'win32_text', 'capture_window', 'activate']) {
    await assert.rejects(native.request({action, ...selected}), error => error.details?.code === 'PROTECTED_COMPANION');
  }
  await assert.rejects(native.request({action: 'invoke', snapshot: observed.snapshot, element_id: button.id}), error => error.details?.code === 'PROTECTED_COMPANION');
  await assert.rejects(native.request({action: 'guard_physical'}), error => error.details?.code === 'APPROVAL_PENDING');
  assert.equal((await native.request({action: 'get_windows', query: title})).windows.length, 0);
  const report = {at: new Date().toISOString(), fixture_only: true, protected_paths: ['UIA', 'Win32', 'app_identity', 'CDP discovery', 'selected-window capture', 'activate', 'old element ref', 'physical input / full-screen capture'], result: 'pass'};
  await writeFile(resolve('benchmarks/results/approval-guard-2026-11-15.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  native.close();
  if (state) await fetch(state.endpoint + '/test/quit', {method: 'POST'}).catch(() => {});
  for (let index = 0; index < 100 && child.exitCode === null; index++) await delay(50);
  if (child.exitCode === null) child.kill();
  assert(scratch.startsWith(resolve(tmpdir()) + sep) && scratch.includes('pokemon-approval-guard-'));
  await rm(scratch, {recursive: true, force: true});
}
