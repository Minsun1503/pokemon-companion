import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {connect} from './client.mjs';

const root = resolve(import.meta.dirname, '..');
const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-api-session-smoke-'));
let requests = 0;
const fixture = createServer((request, response) => {
  if (request.url.startsWith('/api/')) {
    requests += 1;
    response.writeHead(200, {'Content-Type': 'application/json'});
    response.end(JSON.stringify({items: ['synthetic inbox'], access_token: 'RESPONSE_SECRET'}));
  } else {
    response.writeHead(200, {'Content-Type': 'text/html', 'Set-Cookie': 'session=SYNTHETIC_COOKIE; HttpOnly; Path=/'});
    response.end(`<title>Pokémon API demonstration fixture</title><button onclick="fetch('/api/list?folder=inbox&token=QUERY_SECRET').then(r=>r.json()).then(()=>document.querySelector('p').textContent='Inbox loaded')">Inbox</button><p>Ready</p>`);
  }
});
await new Promise(done => fixture.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${fixture.address().port}`;
const decode = result => result.structuredContent ?? JSON.parse(result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'));
let session;
const call = async (name, args) => decode(await session.call(name, args));
try {
  session = await connect({root, args: [resolve(root, 'scripts/start-mcp.cjs')], env: {...process.env,
    POKEMON_UI: 'off', POKEMON_LEARNING: 'off', POKEMON_AUTHORIZATION: 'host-client',
    POKEMON_API_DIR: resolve(scratch, 'api'), POKEMON_LEARNING_DIR: resolve(scratch, 'learning')}});
  const listed = await session.client.listTools();
  assert(listed.tools.some(tool => tool.name === 'api'));
  const browser = await call('browser', {action: 'launch', headless: true, profile: resolve(scratch, 'profile')});
  await call('browser', {action: 'navigate', page_id: browser.page_id, url: origin});
  assert((await call('browser', {action: 'tabs', session_id: browser.session_id})).pages.some(page => page.page_id === browser.page_id));
  await call('api', {action: 'watch_start', page_id: browser.page_id, url_prefix: origin + '/api/'});
  const snapshot = await call('browser', {action: 'snapshot', page_id: browser.page_id, query: 'Inbox'});
  await call('browser', {action: 'click', page_id: browser.page_id, ref: snapshot.nodes.find(node => node.name === 'Inbox').ref});
  let catalog;
  for (let i = 0; i < 40; i++) {
    catalog = await call('api', {action: 'watch_read', page_id: browser.page_id});
    if (catalog.operations.length) break;
    await delay(100);
  }
  assert.equal(catalog.operations.length, 1);
  const row = catalog.operations[0];
  assert.equal(row.trigger.label, 'Inbox');
  await call('api', {action: 'watch_stop', page_id: browser.page_id});
  const preview = await call('api', {action: 'inspect', page_id: browser.page_id, operation_id: row.operation_id, revision: row.revision});
  assert(!JSON.stringify(preview).includes('QUERY_SECRET'));
  const rejected = await session.client.callTool({name: 'api', arguments: {action: 'execute', page_id: browser.page_id, operation_id: row.operation_id, revision: row.revision}});
  assert(rejected.isError);
  assert.equal(decode(rejected).error_details.code, 'API_REVIEW_REQUIRED');
  await call('api', {action: 'review', page_id: browser.page_id, operation_id: row.operation_id, revision: row.revision, effect: 'read'});
  const result = await call('api', {action: 'execute', page_id: browser.page_id, operation_id: row.operation_id, revision: row.revision, query: {folder: 'archive'}});
  assert.equal(result.outcome, 'success');
  assert(!JSON.stringify(result).includes('RESPONSE_SECRET'));
  assert.equal(requests, 2);
  await call('browser', {action: 'close', session_id: browser.session_id});
  console.log(JSON.stringify({passed: true, tool_registered: true, demonstrated: 1, explicitly_replayed: 1, unreviewed_execution: 'blocked', secrets: 'redacted'}));
} finally {
  await session?.client.close();
  fixture.closeAllConnections();
  await new Promise(done => fixture.close(done));
  await rm(scratch, {recursive: true, force: true});
}
