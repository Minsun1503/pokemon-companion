import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, readFile, rm, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, relative} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from '../backend/node_modules/playwright/index.mjs';
import {bundledChromium} from '../backend/dist/browser/bundled.js';
import {LocalJournal} from '../backend/dist/learning/privacy.js';
import {HarnessStore} from '../backend/dist/harness/store.js';
import {defaultConfig} from '../backend/dist/harness/config.js';
import {GatewayApprovals} from '../backend/dist/harness/approvals.js';
import {HarnessEngine} from '../backend/dist/harness/engine.js';
import {harnessRuntime} from '../backend/dist/harness/runtime.js';
import {TelegramGateway} from '../backend/dist/harness/telegram.js';
import {setupApp} from '../backend/dist/harness/setup-server.js';

const home = await mkdtemp(resolve(tmpdir(), 'pokemon-harness-smoke-'));
Object.assign(process.env, {
  POKEMON_UI: 'off', POKEMON_LEARNING: 'off', POKEMON_WEB_PROFILE: resolve(home, 'browser'),
  POKEMON_LEARNING_DIR: resolve(home, 'learning'), POKEMON_CONNECTIONS_FILE: resolve(home, 'connections.json'),
  POKEMON_ACTIONS_DIR: resolve(home, 'actions'),
});
const output = [], modelRequests = [], approvalCodes = [];
const updates = [{update_id: 1, message: {text: '/task@fixture_bot Fill Fixture note with hello from Telegram and verify it.', from: {id: 1}, chat: {id: -1001, type: 'supergroup'}}}];
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
      const code = body.text.match(/\/allow ([a-f0-9]{32})/)?.[1];
      if (code) {
        assert.equal(body.chat_id, 1, 'Approval code must be delivered privately.');
        approvalCodes.push(code);
        updates.push({update_id: nextUpdate++, message: {text: `/allow ${code}`, from: {id: 1}, chat: {id: 1, type: 'private'}}});
      }
      if (body.text === 'Verified fixture completion.') {assert.equal(body.chat_id, -1001); finish();}
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
let tools, gateway, polling, ui, setupServer, timer;
try {
  await store.open();
  await store.putSecrets({FIXTURE_API_KEY: 'fixture-secret'});
  const config = structuredClone(defaultConfig);
  config.routes.fixture = {...config.routes.deepseek, label: 'Fixture API', model: 'fixture-model', baseUrl: `${base}/v1`, keyEnv: 'FIXTURE_API_KEY'};
  config.defaultRoute = 'fixture';
  const approvals = new GatewayApprovals(10000);
  tools = await harnessRuntime(approvals);
  assert(!(await tools.list()).some(tool => tool.name === 'learning'));
  const engine = new HarnessEngine(config, store, approvals, tools);
  gateway = new TelegramGateway(engine, 'fixture', new Set(['1']), base, new Set(['-1001']));
  polling = gateway.run();
  await Promise.race([completed, new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('Harness smoke timed out.')), 30000);})]);
  clearTimeout(timer);
  assert(filled, JSON.stringify(output));
  assert.equal(modelStep, 6);
  assert(approvalCodes.length >= 2, 'Navigation and fill both require approval.');
  for (const code of approvalCodes) assert(!JSON.stringify(modelRequests).includes(code));
  assert(!JSON.stringify(modelRequests).includes('fixture-secret'));
  for (let i = 0; engine.busy && i < 100; i++) await delay(20);
  assert(!engine.busy, 'Completed turn must settle before shutdown.');
  gateway.stop(); await polling; await engine.close();

  // Drive the real setup page through its DOM and authenticated HTTP API.
  const setup = setupApp({home, config, store, busy: () => false, telegramStatus: () => 'fixture', changed: async () => {}});
  setupServer = setup.app.listen(0, '127.0.0.1');
  await new Promise(resolve => setupServer.once('listening', resolve));
  ui = await chromium.launch({executablePath: bundledChromium(), headless: true});
  const page = await ui.newPage({viewport: {width: 1200, height: 1000}});
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${setupServer.address().port}/#${setup.token}`);
  await page.waitForFunction(() => document.querySelector('#route').value === 'fixture');
  await page.locator('#notice').filter({hasText: 'Telegram: fixture'}).waitFor();
  await page.locator('#newRoute').click();
  await page.locator('#name').fill('my-proxy');
  await page.locator('#baseUrl').fill(`${base}/v1`);
  await page.locator('#model').fill('custom-model');
  await page.locator('#key').fill('private-ui-fixture');
  const routeSaved = page.waitForResponse(response => response.url().includes('/api/config') && response.ok());
  await page.locator('#saveRoute').click();
  await routeSaved;
  await page.waitForFunction(() => document.querySelector('#route').value === 'my-proxy');
  const defaultSaved = page.waitForResponse(response => response.url().includes('/api/config') && response.ok());
  await page.locator('#makeDefault').click();
  await defaultSaved;
  await page.locator('#notice').filter({hasText: 'Saved.'}).waitFor();
  await setup.settled();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#route').value === 'my-proxy');
  await page.locator('#notice').filter({hasText: 'Telegram: fixture'}).waitFor();
  assert.equal(await page.locator('#key').inputValue(), '');
  assert.equal(errors.length, 0, errors.join('\n'));
  await mkdir(resolve('output/harness'), {recursive: true});
  await page.screenshot({path: resolve('output/harness/setup.png'), fullPage: true});
  const disk = await readFile(resolve(home, 'store/events.enc'), 'utf8');
  assert(!disk.includes('private-ui-fixture'));
  const report = {created_at: new Date().toISOString(), status: 'pass', group_task: 'addressed task from allowed user/group', approval_channel: 'owning user private chat', model_tool_steps: modelStep, private_approvals: approvalCodes.length, dom_fill_verified: filled, setup: 'saved custom route, selected default, reload authenticated', storage: 'AES-GCM journal with OS user key protection', limits: ['Telegram and provider endpoints were local fixtures; no live accounts or provider billing used.', 'Actual bundled Chromium, DOM references, MCP tools and approval path executed.']};
  await mkdir(resolve('benchmarks/results'), {recursive: true});
  await writeFile(resolve('benchmarks/results/harness-smoke-2026-11-15.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearTimeout(timer);
  gateway?.stop(); await polling?.catch(() => {});
  await ui?.close(); await tools?.close(); await store.close();
  if (setupServer) {setupServer.closeAllConnections(); await new Promise(resolve => setupServer.close(resolve));}
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  const checked = relative(resolve(tmpdir()), resolve(home));
  assert(checked.startsWith('pokemon-harness-smoke-') && !checked.startsWith('..'));
  await rm(home, {recursive: true, force: true});
}
