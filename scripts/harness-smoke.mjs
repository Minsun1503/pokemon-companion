import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, readFile, rm, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, relative} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalJournal} from '../backend/dist/learning/privacy.js';
import {HarnessStore} from '../backend/dist/harness/store.js';
import {GatewayApprovals} from '../backend/dist/harness/approvals.js';
import {HarnessEngine} from '../backend/dist/harness/engine.js';
import {harnessRuntime} from '../backend/dist/harness/runtime.js';
import {TelegramGateway} from '../backend/dist/harness/telegram.js';
import {approvePairing, requestPairing} from '../backend/dist/harness/pairing.js';
import {loadConfig} from '../backend/dist/harness/config.js';

const home = await mkdtemp(resolve(tmpdir(), 'pokemon-harness-smoke-'));
Object.assign(process.env, {
  POKEMON_UI: 'off', POKEMON_LEARNING: 'off', POKEMON_WEB_PROFILE: resolve(home, 'browser'),
  POKEMON_LEARNING_DIR: resolve(home, 'learning'), POKEMON_CONNECTIONS_FILE: resolve(home, 'connections.json'),
  POKEMON_ACTIONS_DIR: resolve(home, 'actions'),
});
const output = [], modelRequests = [];
const updates = [{update_id: 1, message: {text: '/task@fixture_bot Fill Fixture note with hello from Telegram and verify it.', from: {id: 1}, chat: {id: 1, type: 'private'}}}];
let nextUpdate = 2, modelStep = 0, pageId, filled = false;
let finish;
const completed = new Promise(resolve => {finish = resolve;});
const decode = result => result.structuredContent ?? JSON.parse(result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'));
const fixture = createServer(async (request, response) => {
  try {
    if (request.url === '/fixture') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<title>Harness fixture</title><div id="note" role="textbox" aria-label="Fixture note" contenteditable="true"></div><p>Owned test form</p>');
      return;
    }
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || '{}');
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/v1/chat/completions') {
      modelRequests.push(body);
      const last = body.messages.at(-1);
      let call;
      if (modelStep === 0) call = {name: 'browser', args: {action: 'launch', headless: true}};
      if (modelStep === 1) {
        pageId = decode(JSON.parse(last.content)).page_id;
        call = {name: 'browser', args: {action: 'navigate', page_id: pageId, url: `${base}/fixture`}};
      }
      if (modelStep === 2) call = {name: 'browser', args: {action: 'snapshot', page_id: pageId}};
      if (modelStep === 3) {
        const snapshot = decode(JSON.parse(last.content));
        assert(Array.isArray(snapshot.nodes), JSON.stringify(snapshot));
        const node = snapshot.nodes.find(node => node.name === 'Fixture note');
        assert(node?.ref);
        call = {name: 'browser', args: {action: 'fill', page_id: pageId, ref: node.ref, text: 'hello from Telegram'}};
      }
      if (modelStep === 4) {
        assert.equal(decode(JSON.parse(last.content)).verified, true);
        call = {name: 'browser', args: {action: 'snapshot', page_id: pageId}};
      }
      if (modelStep === 5) {
        assert.equal(decode(JSON.parse(last.content)).nodes.find(node => node.name === 'Fixture note').value, 'hello from Telegram');
        filled = true;
      }
      const message = call ? {content: null, tool_calls: [{id: `fixture-${modelStep}`, type: 'function', function: {name: call.name, arguments: JSON.stringify(call.args)}}]} : {content: 'Verified fixture completion.'};
      modelStep += 1;
      response.end(JSON.stringify({choices: [{message}]}));
      return;
    }
    let result = true;
    if (request.url.endsWith('/getMe')) result = {id: 77, username: 'fixture_bot'};
    if (request.url.endsWith('/getUpdates')) {
      await delay(30);
      result = updates.filter(update => update.update_id >= (body.offset || 0));
    }
    if (request.url.endsWith('/sendMessage')) {
      output.push(body.text);
      result = {message_id: 1000 + output.length};
      const code = /Mã ghép cặp: ([A-Z2-9]{8})/.exec(body.text)?.[1];
      if (code) {
        // The owner approves locally, then the original request is sent again.
        await approvePairing(home, code);
        updates.push({update_id: nextUpdate++, message: {...updates[0].message}});
      }
      if (body.text === 'Verified fixture completion.') {assert.equal(body.chat_id, 1); finish();}
      if (body.text.startsWith('Task stopped:')) finish();
    }
    response.end(JSON.stringify({ok: true, result}));
  } catch (error) {
    console.error('Owned harness fixture failed:', error.message);
    response.writeHead(500); response.end(JSON.stringify({error: error.message})); finish();
  }
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${fixture.address().port}`;
const store = new HarnessStore(new LocalJournal(resolve(home, 'store')));
let tools, gateway, polling, timer;
try {
  await store.open();
  await store.putSecrets({FIXTURE_API_KEY: 'fixture-secret'});
  const config = await loadConfig(home);
  config.routes.fixture = {...config.routes.deepseek, label: 'Fixture API', model: 'fixture-model', baseUrl: `${base}/v1`, keyEnv: 'FIXTURE_API_KEY'};
  config.defaultRoute = 'fixture';
  const approvals = new GatewayApprovals();
  tools = await harnessRuntime(approvals);
  assert(!(await tools.list()).some(tool => tool.name === 'learning'));
  const engine = new HarnessEngine(config, store, approvals, tools);
  gateway = new TelegramGateway(engine, 'fixture', async () => {
    const current = await loadConfig(home);
    return {users: new Set(current.telegram.allowedUsers), groups: new Set(current.telegram.allowedGroups)};
  }, async (userId, name) => requestPairing(home, userId, name), base);
  polling = gateway.run();
  await Promise.race([completed, new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('Harness smoke timed out.')), 30000);})]);
  clearTimeout(timer);
  assert(filled, JSON.stringify(output));
  assert.equal(modelStep, 6);
  assert(output.some(text => text.includes('Mã ghép cặp')), 'Unknown sender received a pairing code first.');
  assert(!JSON.stringify(modelRequests).includes('Mã ghép cặp'), 'Pairing never reaches the model.');
  assert(!JSON.stringify(modelRequests).includes('fixture-secret'));
  for (let i = 0; engine.busy && i < 100; i++) await delay(20);
  assert(!engine.busy, 'Completed turn must settle before shutdown.');
  gateway.stop(); await polling; await engine.close();

  const disk = await readFile(resolve(home, 'store/events.enc'), 'utf8');
  assert(!disk.includes('fixture-secret'));
  const report = {created_at: new Date().toISOString(), status: 'pass', access: 'DM pairing code approved locally, then the private task ran', model_tool_steps: modelStep, dom_fill_verified: filled, storage: 'AES-GCM journal with OS user key protection', limits: ['Telegram and provider endpoints were local fixtures; no live accounts or provider billing used.', 'Actual bundled Chromium, DOM references, MCP tools and pairing path executed.']};
  await mkdir(resolve('benchmarks/results'), {recursive: true});
  await writeFile(resolve('benchmarks/results/harness-smoke-latest.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearTimeout(timer);
  gateway?.stop(); await polling?.catch(() => {});
  await tools?.close(); await store.close();
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  const checked = relative(resolve(tmpdir()), resolve(home));
  assert(checked.startsWith('pokemon-harness-smoke-') && !checked.startsWith('..'));
  await rm(home, {recursive: true, force: true});
}
