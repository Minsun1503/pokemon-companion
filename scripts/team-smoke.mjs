import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, rm, mkdir, writeFile} from 'node:fs/promises';
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

const home = await mkdtemp(resolve(tmpdir(), 'pokemon-team-smoke-'));
const checked = relative(resolve(tmpdir()), resolve(home));
assert(checked.startsWith('pokemon-team-smoke-') && !checked.startsWith('..'));
Object.assign(process.env, {
  POKEMON_UI: 'off', POKEMON_LEARNING: 'off', POKEMON_WEB_PROFILE: resolve(home, 'browser'),
  POKEMON_LEARNING_DIR: resolve(home, 'learning'), POKEMON_CONNECTIONS_FILE: resolve(home, 'connections.json'),
  POKEMON_ACTIONS_DIR: resolve(home, 'actions'),
});
const decode = result => result.structuredContent ?? JSON.parse(result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'));
let rootStep = 0, pageId, nextUpdate = 2, activeChildren = 0, peakChildren = 0;
const requests = [], replies = [], approvalCodes = [];
const updates = [{update_id: 1, message: {text: '/team@team_fixture Read the fixture evidence, then ask writer and reviewer for independent artifacts and return the checked answer.', from: {id: 1}, chat: {id: 1, type: 'private'}}}];
let finish;
const completed = new Promise(resolve => { finish = resolve; });
let base;
const fixture = createServer(async (request, response) => {
  try {
    if (request.url === '/evidence') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<title>Team fixture evidence</title><h1>Verified fixture evidence</h1><p>The synthetic inventory count is 42.</p>');
      return;
    }
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || '{}');
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/v1/chat/completions') {
      requests.push(body);
      assert.equal(body.max_tokens, 2048);
      const system = body.messages[0].content;
      let message;
      if (system.includes('writer specialist') || system.includes('reviewer specialist')) {
        assert.equal(body.messages.length, 2, 'Each specialist gets a fresh transcript.');
        assert.equal(body.tools, undefined, 'Writer/reviewer have no external tools.');
        assert(body.messages[1].content.includes('42'));
        activeChildren += 1; peakChildren = Math.max(peakChildren, activeChildren);
        await delay(80);
        activeChildren -= 1;
        message = {content: system.includes('writer specialist') ? 'Writer artifact: the synthetic count is 42.' : 'Reviewer artifact: evidence supports 42; no real inventory was inspected.'};
      } else {
        const last = body.messages.at(-1);
        let call;
        if (rootStep === 0) {
          assert.deepEqual(body.tools.map(tool => tool.function.name), ['delegate', 'find_tools']);
          call = {name: 'find_tools', args: {query: 'browser'}};
        }
        if (rootStep === 1) call = {name: 'browser', args: {action: 'launch', headless: true}};
        if (rootStep === 2) {
          pageId = decode(JSON.parse(last.content)).page_id;
          assert(pageId);
          call = {name: 'browser', args: {action: 'navigate', page_id: pageId, url: `${base}/evidence`}};
        }
        if (rootStep === 3) call = {name: 'browser', args: {action: 'snapshot', page_id: pageId}};
        if (rootStep === 4) {
          assert(last.content.includes('synthetic inventory count is 42'));
          call = {name: 'delegate', args: {tasks: [
            {role: 'writer', instruction: 'Draft the result from this evidence.', context: `Fixture ${base}/evidence: synthetic inventory count is 42.`},
            {role: 'reviewer', instruction: 'Independently check the evidence and limitations.', context: `Fixture ${base}/evidence: synthetic inventory count is 42.`},
          ]}};
        }
        if (rootStep === 5) {
          assert(last.content.includes('Writer artifact'));
          assert(last.content.includes('Reviewer artifact'));
        }
        message = call ? {content: null, tool_calls: [{id: `team-${rootStep}`, type: 'function', function: {name: call.name, arguments: JSON.stringify(call.args)}}]} : {content: 'Verified team fixture result: 42 (synthetic data only).'};
        rootStep += 1;
      }
      response.end(JSON.stringify({choices: [{message}], usage: {prompt_tokens: 100, completion_tokens: 30}}));
      return;
    }
    let result = true;
    if (request.url.endsWith('/getMe')) result = {id: 77, username: 'team_fixture'};
    if (request.url.endsWith('/getUpdates')) {
      await delay(20);
      result = updates.filter(update => update.update_id >= (body.offset || 0));
    }
    if (request.url.endsWith('/sendMessage')) {
      replies.push({chat: body.chat_id, text: body.text});
      const callbackData = body.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data;
      const messageId = 1000 + replies.length;
      result = {message_id: messageId};
      if (callbackData) {
        assert.equal(body.chat_id, 1, 'Approval stays in the private session.');
        assert(!body.text.includes('/allow'), 'The approval code is not exposed in message text.');
        approvalCodes.push(callbackData.slice(5));
        updates.push({update_id: nextUpdate++, callback_query: {id: 'fixture-' + nextUpdate, data: callbackData, from: {id: 1}, message: {message_id: messageId, from: {id: 77, is_bot: true}, chat: {id: 1, type: 'private'}}}});
      }
      if (body.text.includes('Verified team fixture result')) finish();
    }
    response.end(JSON.stringify({ok: true, result}));
  } catch (error) {
    response.statusCode = 500;
    response.end(JSON.stringify({ok: false, description: error.message}));
    finish(error);
  }
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
base = `http://127.0.0.1:${fixture.address().port}`;
const store = new HarnessStore(new LocalJournal(resolve(home, 'store'), Buffer.alloc(32, 14)));
let runtime, engine, gateway, gatewayRun, setupServer, browser;
const started = performance.now();
try {
  await store.open();
  const registration = await store.register('77', '1', '-1001');
  await store.putSecrets({TEAM_SMOKE_KEY: 'fixture-only-not-a-real-key', TELEGRAM_BOT_TOKEN: 'fixture-token'});
  const config = structuredClone(defaultConfig);
  config.routes.deepseek = {...config.routes.deepseek, keyEnv: 'TEAM_SMOKE_KEY', model: 'fixture', baseUrl: `${base}/v1`, pricing: {input: 1, output: 2}};
  config.telegram = {enabled: true, allowedUsers: ['1'], allowedGroups: ['-1001']};
  const approvals = new GatewayApprovals(10000);
  runtime = await harnessRuntime(approvals);
  engine = new HarnessEngine(config, store, approvals, runtime);
  gateway = new TelegramGateway(engine, 'fixture-token', new Set(['1']), base, new Set(['-1001']));
  gatewayRun = gateway.run();
  const failure = await Promise.race([completed, delay(25000).then(() => { throw Error(`Team smoke timed out: ${JSON.stringify(replies)}`); })]);
  if (failure) throw failure;
  gateway.stop(); await gatewayRun;
  const task = store.tasks(`telegram:77:1:session:${registration.session}`)[0];
  assert.equal(task.status, 'completed');
  assert.equal(task.modelCalls, 8);
  assert.equal(task.inputTokens, 800);
  assert.equal(task.outputTokens, 240);
  assert.equal(task.unknownUsage, 0);
  assert.equal(task.artifacts.length, 2);
  assert.equal(peakChildren, 2);
  assert(approvalCodes.length >= 1);
  for (const code of approvalCodes) assert(!JSON.stringify(requests).includes(code));

  const setup = setupApp({home, config, store, busy: () => engine.busy, telegramStatus: () => 'fixture', changed: async () => {}}, 'fixture-setup-token');
  setupServer = setup.app.listen(0, '127.0.0.1');
  await new Promise(resolve => setupServer.once('listening', resolve));
  browser = await chromium.launch({headless: true, executablePath: await bundledChromium()});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${setupServer.address().port}/#fixture-setup-token`);
  await page.locator('#teamCalls').waitFor();
  await page.waitForFunction(() => document.querySelector('#teamCalls').value === '24');
  await page.locator('#teamCalls').fill('18');
  await page.locator('#teamAuto').check();
  await page.locator('#saveTeam').click();
  await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('Saved.'));
  assert.equal(config.team.maxModelCalls, 18);
  assert.equal(config.team.auto, true);
  await page.locator('#inputPrice').fill('2');
  await page.locator('#outputPrice').fill('10');
  await page.locator('#saveRoute').click();
  await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('Saved.'));
  assert.deepEqual(config.routes.deepseek.pricing, {input: 2, output: 10});
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#teamCalls').value === '18');
  assert.equal(await page.locator('#teamAuto').isChecked(), true);
  assert.deepEqual(errors, []);
  await page.setViewportSize({width: 1100, height: 1200});
  await page.locator('#saveTeam').scrollIntoViewIfNeeded();
  const output = resolve('benchmarks/results');
  await mkdir(output, {recursive: true});
  await page.locator('section').filter({has: page.locator('#saveTeam')}).screenshot({path: resolve(output, 'team-setup-smoke.png')});
  const report = {checkedAt: new Date().toISOString(), outcome: 'passed', fixturesOnly: true, paidProviderVerified: false, liveTelegramVerified: false, modelRequests: task.modelCalls, inputTokens: task.inputTokens, outputTokens: task.outputTokens, specialistArtifacts: task.artifacts.length, peakParallelSpecialists: peakChildren, privateApprovals: approvalCodes.length, modelTranscriptsExcludeApprovalCodes: true, toolEvidence: 'real in-process MCP browser snapshot of synthetic fixture', setupPersistenceVerified: true, elapsedMs: Math.round(performance.now() - started)};
  await writeFile(resolve(output, 'team-smoke-latest.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  gateway?.stop();
  await gatewayRun?.catch(() => {});
  await engine?.close();
  await browser?.close();
  await runtime?.close();
  if (setupServer) await new Promise(resolve => setupServer.close(resolve));
  await store.close();
  await new Promise(resolve => fixture.close(resolve));
  await rm(home, {recursive: true, force: true});
}
