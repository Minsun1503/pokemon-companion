import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, sep} from 'node:path';
import {PokemonRuntime} from '../backend/dist/pokemon/runtime.js';
import {approvalIntent} from '../backend/dist/security/approval.js';

const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-approval-bridge-'));
process.env.POKEMON_UI = 'on';
process.env.POKEMON_USER_DATA_DIR = scratch;
process.env.POKEMON_IDLE_ANIMATION = 'off';
process.env.POKEMON_LEARNING = 'off';
delete process.env.POKEMON_AUTHORIZATION;
const runtime = new PokemonRuntime();
const intent = approvalIntent('browser', 'click', 'Send message (synthetic fixture)', 'https://example.test/chat/fixture', 'Synthetic test only; no external message will be sent.', {state: 'fixture'}, {recipient: 'fixture'});
try {
  await runtime.companion.start();
  await assert.rejects(runtime.authorize(intent, async () => intent), error => error.details?.code === 'APPROVAL_REQUIRED');
  assert(typeof runtime.companion.server.address() === 'string');
  assert(runtime.companion.server.address().startsWith('\\\\.\\pipe\\pokemon-companion-'));
  const protection = await runtime.windows.request({action: 'trusted_window_status'});
  assert(protection.protected_windows >= 2, 'Protect the hidden anchor and live dialog before returning.');
  assert(protection.approval_windows >= 1, 'Register the live approval dialog before returning.');
  assert(protection.visible_approvals >= 1, 'Show a protected approval dialog before returning.');
  console.log('Native protection status:', protection);
  await assert.rejects(runtime.windows.request({action: 'guard_physical'}), error => error.details?.code === 'APPROVAL_PENDING');
  assert.equal((await runtime.windows.request({action: 'get_windows', query: 'Pokémon action approval'})).windows.length, 0);
  const report = {at: new Date().toISOString(), fixture_only: true, bridge: 'Windows named pipe; private capability; default process DACL', companion_key: 'Electron safeStorage / Windows DPAPI', without_human_approval: 'no execution', dialog_visible_and_native_protected: true, protection, startup_wait_after_response_ms: 0, result: 'pass'};
  await writeFile(resolve('benchmarks/results/approval-companion-2026-11-15.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  await runtime.close();
  assert(scratch.startsWith(resolve(tmpdir()) + sep) && scratch.includes('pokemon-approval-bridge-'));
  await rm(scratch, {recursive: true, force: true, maxRetries: 30, retryDelay: 100});
}
