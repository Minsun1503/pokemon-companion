import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {connect} from './client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-app-adapter-'));
const report = {at: new Date().toISOString(), phases: []};
const title = 'Pokemon adapter fixture ' + randomUUID().slice(0, 8);
const fixtureScript = resolve(root, 'scripts/app-adapter-fixture.cjs');
const electron = resolve(root, 'frontend/node_modules/electron/dist/electron.exe');
let session, fixture, fixtureState, appCount = 0;
const web = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(request.url === '/ready'
    ? '<title>Web fixture</title><div id="signin" hidden>Sign in</div><div id="messages">Web messages available</div><button>Read web</button>'
    : '<title>Web fixture signed out</title><div id="signin">Sign in</div>');
});
await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
const webBase = `http://127.0.0.1:${web.address().port}`;
const environment = {...process.env, POKEMON_UI: 'off', POKEMON_CONNECTIONS_FILE: resolve(scratch, 'connections.json'),
  POKEMON_WEB_PROFILE: resolve(scratch, 'web-profile'), POKEMON_LEARNING_DIR: resolve(scratch, 'learning')};
const decode = result => result.structuredContent ?? JSON.parse(result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'));
async function call(name, args) {return decode(await session.call(name, args));}
async function poll(run, test, timeout = 15000) {
  const deadline = performance.now() + timeout; let last;
  do {last = await run(); if (test(last)) return last; await delay(100);} while (performance.now() < deadline);
  throw new Error('Live fixture did not become ready: ' + JSON.stringify(last));
}
async function openMcp() {session = await connect({env: environment});}
async function launchFixture(cdp) {
  const directory = resolve(scratch, 'fixture-' + (++appCount)), state = resolve(directory, 'state.json');
  await mkdir(directory);
  const fixtureEnvironment = {...process.env};
  delete fixtureEnvironment.ELECTRON_RUN_AS_NODE;
  fixture = spawn(electron, [fixtureScript], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: {...fixtureEnvironment,
    POKEMON_FIXTURE_PROFILE: directory, POKEMON_FIXTURE_STATE: state, POKEMON_FIXTURE_TITLE: title, POKEMON_FIXTURE_CDP: cdp ? 'on' : 'off'}});
  let errors = ''; fixture.stderr.on('data', data => {errors = (errors + data).slice(-4000);});
  fixtureState = await poll(async () => {
    if (fixture.exitCode !== null) throw new Error('Fixture exited: ' + errors);
    try {return JSON.parse(await readFile(state, 'utf8'));} catch {return null;}
  }, Boolean);
}
async function quitFixture() {
  if (!fixture) return;
  const child = fixture;
  await fetch(fixtureState.endpoint + '/test/quit', {method: 'POST'}).catch(() => {});
  await poll(async () => child.exitCode, value => value !== null, 10000);
  fixture = undefined;
}
async function window() {
  let result;
  try {
    result = await poll(() => call('windows', {action: 'get_windows', query: title}), value => value.complete && value.windows.length === 1);
  } catch (error) {
    console.error('Fixture state:', fixtureState, 'Visible Electron windows:', await call('windows', {action: 'get_windows', query: 'electron'}));
    throw error;
  }
  return {window_id: result.windows[0].id, window_ref: result.windows[0].window_ref};
}
async function appArgs(path, extra = {}) {
  return {action: 'read', app_id: 'lifecycle', web_urls: [webBase + path], web_ready_selector: '#messages', web_unavailable_selector: '#signin',
    desktop_query: title, timeout_ms: 2000, ...await window(), ...extra};
}
async function phase(name, run) {
  console.log(name); const started = performance.now(); const result = await run();
  report.phases.push({name, duration_ms: performance.now() - started, result}); return result;
}
try {
  await openMcp();
  await launchFixture(true);
  const readyWeb = await phase('web first; hidden sign-in UI does not block a ready page', async () => {
    const result = await call('app', await appArgs('/ready')); assert.equal(result.surface, 'web'); assert.equal(result.method, 'playwright');
    assert(result.data.text.text.includes('Web messages available')); return {surface: result.surface, method: result.method, session_id: result.data.session_id};
  });
  await phase('closing a web context permits a fresh application session', async () => {
    await call('browser', {action: 'close', session_id: readyWeb.session_id});
    const result = await call('app', await appArgs('/ready')); assert.equal(result.method, 'playwright');
    assert.notEqual(result.data.session_id, readyWeb.session_id); return {method: result.method};
  });
  const first = await phase('signed-out web falls back to automatic CDP discovery', async () => {
    const result = await call('app', await appArgs('/login')); assert.equal(result.method, 'cdp', JSON.stringify(result));
    assert.equal(result.cache_hit, false); return result;
  });
  await phase('new MCP process reuses persisted CDP metadata', async () => {
    await session.client.close(); await openMcp();
    const result = await call('app', await appArgs('/login')); assert.equal(result.method, 'cdp'); assert.equal(result.cache_hit, true); return result;
  });
  await phase('CDP port changes; cached endpoint is rejected and rediscovered', async () => {
    await quitFixture(); await launchFixture(true);
    const result = await call('app', await appArgs('/login')); assert.equal(result.method, 'cdp'); assert.equal(result.rediscovered, true);
    assert.notEqual(result.data.url, first.data.url); return result;
  });
  await quitFixture(); await launchFixture(false);
  await phase('local API detected when desktop CDP is unavailable', async () => {
    const result = await call('app', await appArgs('/login', {action: 'api_get', api_operation: 'readMessages'}));
    assert.equal(result.method, 'api'); assert.equal(JSON.parse(result.data.text).messages[0], 'hello'); return result;
  });
  await phase('API route reused across MCP sessions', async () => {
    await session.client.close(); await openMcp();
    const result = await call('app', await appArgs('/login', {action: 'api_get', api_operation: 'readMessages'}));
    assert.equal(result.cache_hit, true); return result;
  });
  await phase('API update: old path fails, current schema and path are rediscovered', async () => {
    await fetch(fixtureState.endpoint + '/test/update', {method: 'POST'});
    const result = await call('app', await appArgs('/login', {action: 'api_get', api_operation: 'readMessages'}));
    assert.equal(result.rediscovered, true); assert.equal(result.method, 'api'); assert.equal(JSON.parse(result.data.text).items[0], 'updated'); return result;
  });
  await phase('a removed operation yields the refreshed API catalog', async () => {
    const result = await call('app', await appArgs('/login', {action: 'api_get', api_operation: 'missingOperation'}));
    assert.equal(result.method, 'api'); assert.equal(result.data.requested_operation_unavailable, 'missingOperation');
    assert(result.data.selection_required); return result;
  });
  await fetch(fixtureState.endpoint + '/test/disable-api', {method: 'POST'});
  await phase('no CDP/API or HWND text; UIA reads the desktop field', async () => {
    const result = await call('app', await appArgs('/login', {app_id: 'native-fixture', query: 'Messages'}));
    assert.equal(result.method, 'uia', JSON.stringify(result));
    assert(result.data.nodes.some(node => node.name === 'Messages')); return result;
  });
  await phase('all semantic routes unavailable; selected-window capture returned', async () => {
    const raw = await session.call('app', await appArgs('/login', {app_id: 'visual-fixture', query: 'missing-control'}));
    const result = decode(raw); assert.equal(result.method, 'screen_capture', JSON.stringify(result));
    assert.deepEqual(result.attempts.map(item => item.method), ['cdp', 'api', 'win32', 'uia', 'screen_capture']);
    const screenshot = raw.content.find(item => item.type === 'image'); assert(screenshot);
    await mkdir(resolve(root, 'output'), {recursive: true});
    await writeFile(resolve(root, 'output/app-adapter-capture-2026-11-14.png'), Buffer.from(screenshot.data, 'base64'));
    return result;
  });
  await phase('high-entropy screenshot uses bounded MIME-correct JPEG', async () => {
    await fetch(fixtureState.endpoint + '/test/noise', {method: 'POST'});
    const raw = await session.call('app', await appArgs('/login', {app_id: 'visual-fixture', query: 'missing-control'}));
    const result = decode(raw); assert.equal(result.method, 'screen_capture', JSON.stringify(result));
    const screenshot = raw.content.find(item => item.type === 'image'); assert(screenshot);
    assert.equal(screenshot.mimeType, 'image/jpeg'); assert.equal(result.data.mime_type, 'image/jpeg');
    const bytes = Buffer.from(screenshot.data, 'base64'); assert(bytes.length <= 1400000);
    assert.equal(bytes.subarray(0, 2).toString('hex'), 'ffd8');
    await writeFile(resolve(root, 'output/app-adapter-bounded-2026-11-14.jpg'), bytes);
    return {mime_type: screenshot.mimeType, bytes: bytes.length, width: result.data.image_width, height: result.data.image_height};
  });
  report.cache = JSON.parse(await readFile(environment.POKEMON_CONNECTIONS_FILE, 'utf8'));
  report.verified = true;
  await mkdir(resolve(root, 'benchmarks/results'), {recursive: true});
  await writeFile(resolve(root, 'benchmarks/results/app-adapter-lifecycle-2026-11-14.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('Verified application routing, persistent CDP/API reuse, and rediscovery.');
} finally {
  await quitFixture().catch(() => {fixture?.kill();});
  await session?.client.close(); web.close();
}
