import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {chromium} from '../backend/node_modules/playwright/index.mjs';
import {connect} from './client.mjs';

const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-browser-smoke-'));
const title = 'Pokemon DOM smoke ' + randomUUID().slice(0, 8);
const fixture = createServer((request, response) => {
  if (request.url.startsWith('/api')) {response.writeHead(200, {'Content-Type': 'application/json'}); response.end('{"message":"API captured"}'); return;}
  response.writeHead(200, {'Content-Type': 'text/html'});
  response.end(`<title>${title}</title><label for="song">Song</label><input id="song"><button aria-label="Fetch API" onclick="fetch('/api?private=excluded').then(r=>r.json()).then(j=>document.querySelector('p').textContent=j.message)">Fetch</button><p>Ready</p>`);
});
await new Promise(done => fixture.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${fixture.address().port}/`;
let context, session, owned;
const report = {};
const decode = result => result.structuredContent ?? JSON.parse(result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'));
async function call(name, args) {return decode(await session.call(name, args));}
async function wait(run, test) {for (let i = 0; i < 80; i++) {const value = await run(); if (test(value)) return value; await delay(100);} throw new Error('Fixture did not become ready.');}
try {
  session = await connect({env: {...process.env, POKEMON_UI: 'off', POKEMON_LEARNING: 'off', POKEMON_LEARNING_DIR: resolve(scratch, 'learning'), POKEMON_CONNECTIONS_FILE: resolve(scratch, 'connections.json')}});
  // A standalone app with an existing CDP port, rather than a Playwright-owned MCP browser.
  const profile = resolve(scratch, 'cdp-app');
  context = await chromium.launchPersistentContext(profile, {channel: 'msedge', headless: false, args: ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--force-renderer-accessibility']});
  await context.pages()[0].goto(url);
  const [port] = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/);
  const listed = await wait(() => call('windows', {action: 'get_windows', query: title}), result => result.complete && result.windows.length === 1);
  const window = {window_id: listed.windows[0].id, window_ref: listed.windows[0].window_ref};
  const selected = await call('app_inspect', {action: 'read', ...window, page_url: url});
  assert.equal(selected.method, 'cdp', JSON.stringify(selected));
  const input = selected.data.nodes.find(node => node.name === 'Song');
  assert(input);
  const filled = await call('browser', {action: 'fill', page_id: selected.data.page_id, ref: input.ref, text: 'Never Gonna Give You Up'});
  assert(filled.verified);
  await call('browser', {action: 'network_start', page_id: selected.data.page_id, url_filter: '/api'});
  const buttons = await call('browser', {action: 'snapshot', page_id: selected.data.page_id, query: 'Fetch API'});
  await call('browser', {action: 'click', page_id: selected.data.page_id, ref: buttons.nodes.find(node => node.name === 'Fetch API').ref});
  const captured = await wait(() => call('browser', {action: 'network_read', page_id: selected.data.page_id}), result => result.events.length === 1);
  assert.equal(captured.events[0].url, url + 'api'); assert(!JSON.stringify(captured).includes('private'));
  report.network_metadata = captured;
  const stale = await session.client.callTool({name: 'browser', arguments: {action: 'fill', page_id: selected.data.page_id, ref: input.ref, text: 'must not be applied'}});
  assert(stale.isError); assert.equal(decode(stale).error_details.code, 'STALE_REF');
  await call('browser', {action: 'close', session_id: selected.data.session_id});
  assert((await fetch(`http://127.0.0.1:${port}/json/version`)).ok);
  assert.equal(await context.pages()[0].title(), title);
  report.cdp_discovery = 'selected owned loopback port'; report.attached_close = 'app survived disconnect'; report.stale_ref = 'rejected';
  await context.close(); context = undefined;
  // This browser has no CDP TCP port, so content must follow the native fallback order.
  owned = await call('browser', {action: 'launch', profile: resolve(scratch, 'no-cdp')});
  await call('browser', {action: 'navigate', page_id: owned.page_id, url});
  const nativeList = await wait(() => call('windows', {action: 'get_windows', query: title}), result => result.complete && result.windows.length === 1);
  const nativeWindow = {window_id: nativeList.windows[0].id, window_ref: nativeList.windows[0].window_ref};
  await call('windows', {action: 'activate', ...nativeWindow});
  const fallback = await call('app_inspect', {action: 'read', ...nativeWindow, query: 'Song'});
  assert.equal(fallback.method, 'uia', JSON.stringify(fallback));
  assert.deepEqual(fallback.attempts.map(item => item.method), ['cdp', 'api', 'win32', 'uia']);
  report.native_fallback = fallback.attempts;
  // An operator-scoped capture fixture proves the API stage precedes the native stages.
  const path = resolve(scratch, 'api-capture.json'), now = Date.now();
  await writeFile(path, JSON.stringify({process_id: nativeList.windows[0].process_id, captured_at: now, events: [{at: now, url: url + 'api', status: 200, body: '{"message":"API captured"}'}]}));
  const api = await call('app_inspect', {action: 'read', ...nativeWindow, api_capture_file: path, api_url_filter: '/api'});
  assert.equal(api.method, 'api'); report.api_fallback = api;
  await writeFile(resolve('benchmarks/results/browser-dom-smoke-2026-11-14.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (owned) await call('browser', {action: 'close', session_id: owned.session_id}).catch(() => {});
  await context?.close(); await session?.client.close(); fixture.close();
}
