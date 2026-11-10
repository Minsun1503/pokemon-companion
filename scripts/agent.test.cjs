const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {runAgent, CompanionAgentTools, isDesktopRequest, agentInstructions} = require('../frontend/build/main/companion/agent.js');

async function model(t, handler) {
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({message: await handler(request)}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  return {baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'test-model'};
}
const tool = (name, args) => ({role: 'assistant', content: '', tool_calls: [{function: {name, arguments: args}}]});

test('agent executes model-selected tools and sends actual results back before completion', async t => {
  const events = []; let round = 0;
  const config = await model(t, request => {
    assert.equal(request.stream, false); assert.equal(request.think, false);
    assert.equal(request.tools[0].function.name, 'github');
    if (++round === 1) return tool('github', {action: 'inspect', folder: 'C:\\dev\\test-push'});
    assert.deepEqual(JSON.parse(request.messages.at(-1).content), {sha: 'actual-tool-result', clean: true});
    assert.equal(request.messages.at(-1).role, 'tool');
    if (round === 2) return tool('task_done', {});
    throw new Error('Completion should return the verified summary immediately');
  });
  const tools = {list: async () => [{type: 'function', function: {name: 'github'}}], call: async (name, args) => {events.push({name, args}); return name === 'task_done' ? {verified: true, summary: 'Inspected the repository.'} : {sha: 'actual-tool-result', clean: true};}};
  assert.equal(await runAgent(config, [{role: 'user', content: 'Inspect my repository'}], tools), 'Inspected the repository.');
  assert.equal(events.length, 2);
});

test('handoff and pause stop immediately before any later queued action', async t => {
  for (const boundary of [{handoff: 'Please click final Authorize.'}, {paused: true}]) {
    const config = await model(t, () => ({...tool('human_handoff', {reason: 'Authorize'}), tool_calls: [...tool('human_handoff', {}).tool_calls, ...tool('github', {action: 'publish'}).tool_calls]}));
    const calls = [];
    const result = await runAgent(config, [], {list: async () => [], call: async name => {calls.push(name); return boundary;}});
    assert.deepEqual(calls, ['human_handoff']);
    assert.match(result, boundary.handoff ? /Authorize/ : /paused/);
  }
});

test('tool errors return to the model and repeated identical actions are bounded', async t => {
  let round = 0, calls = 0;
  const config = await model(t, request => {
    if (++round > 1) assert.match(request.messages.at(-1).content, /fresh inspection required/);
    return tool('windows', {action: 'invoke', ref: 'expired'});
  });
  const result = await runAgent(config, [], {list: async () => [], call: async () => {calls++; throw new Error('fresh inspection required');}});
  assert.equal(calls, 3); assert.equal(round, 4); assert.match(result, /repeating/);
});

test('changing argument order cannot bypass the repeated-action limit', async t => {
  let round = 0, calls = 0;
  const config = await model(t, () => tool('windows', ++round % 2 ? {action: 'invoke', target: 'c1'} : {target: 'c1', action: 'invoke'}));
  const result = await runAgent(config, [], {list: async () => [], call: async () => {calls++; return {error: 'Unsupported action'};}});
  assert.equal(calls, 3);
  assert.match(result, /repeating/);
});

test('a desktop task cannot end with a promise; only verified task_done ends it', async t => {
  let round = 0;
  const config = await model(t, request => {
    if (++round === 1) return {role: 'assistant', content: 'I will open Teams.'};
    if (round === 2) {
      assert.match(request.messages.at(-1).content, /still unfinished/);
      return tool('windows', {action: 'wait_for'});
    }
    if (round === 3) return {role: 'assistant', content: 'Done without completing the whole task.'};
    assert.match(request.messages.at(-1).content, /still unfinished/);
    return tool('task_done', {});
  });
  const result = await runAgent(config, [], {list: async () => [], call: async name => name === 'task_done' ? {verified: true, summary: 'Found Damien in Teams.'} : {verified: true}}, undefined, true);
  assert.equal(result, 'Found Damien in Teams.'); assert.equal(round, 4);
});

test('real worker offers native computer tools without a GitHub login prerequisite', {timeout: 20000}, async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokemon-agent-test-'));
  let paused = true;
  const bridge = new CompanionAgentTools(path.resolve(__dirname, '../frontend'), profile, () => paused);
  t.after(() => {bridge.close(); assert.equal(path.dirname(profile), path.resolve(os.tmpdir())); fs.rmSync(profile, {recursive: true, force: true});});
  const pika = bridge.forPet('pikachu');
  const definitions = await pika.list();
  assert.deepEqual(definitions.map(item => item.function.name), ['desktop', 'windows', 'computer', 'human_handoff', 'task_done']);
  assert.deepEqual(await pika.call('windows', {action: 'get_windows'}), {paused: true});
  paused = false; bridge.syncPause();
  assert.deepEqual(await pika.authorize('bây giờ mở team lên, sau đó tìm Damien'), {ready: true});
  await assert.rejects(pika.call('github', {action: 'login'}), /Unknown Pokémon desktop tool/);
  const result = await pika.call('windows', {action: 'get_windows', query: 'not-an-actual-app-712489'});
  assert.equal(result.error, undefined);
  assert.deepEqual(result.windows, []);
  await assert.rejects(pika.call('computer', {action: 'key', text: 'Return'}), /window_id/);
});

test('Vietnamese and English desktop intent require completion; conversation stays conversational', async t => {
  for (const request of ['bây giờ mở team lên, sau đó tìm Damien', 'Open Teams and search for Damien', 'Can you click that button?', 'Hãy nhập ABC vào Notepad', 'Đọc nội dung cửa sổ này']) assert.equal(isDesktopRequest(request), true);
  for (const request of ['Xin chào', 'Hello!', 'How do I open Teams?', 'Explain how to click a button']) assert.equal(isDesktopRequest(request), false);
  assert.doesNotMatch(agentInstructions, /github login|github publish|github auth_status/);
  const config = await model(t, () => ({role: 'assistant', content: 'Xin chào!'}));
  assert.equal(await runAgent(config, [], {list: async () => [], call: async () => {throw new Error('Conversation must not act');}}), 'Xin chào!');
});

test('desktop harness begins with real observation and provides it to the model', async t => {
  const events = [];
  const config = await model(t, request => {
    const observation = request.messages.at(-1);
    assert.equal(observation.role, 'tool');
    assert.equal(observation.tool_name, 'windows');
    assert.equal(JSON.parse(observation.content).windows[0].id, 'actual-window-42');
    return tool('task_done', {});
  });
  const tools = {list: async () => [{type: 'function', function: {name: 'windows'}}], call: async (name, args) => {
    events.push({name, args});
    return name === 'windows' ? {windows: [{id: 'actual-window-42'}]} : {verified: true, summary: 'Done'};
  }};
  assert.equal(await runAgent(config, [{role: 'user', content: 'Read my app'}], tools, undefined, true), 'Done');
  assert.deepEqual(events[0], {name: 'windows', args: {action: 'get_windows', max_chars: 6000}});
});

test('repeated plans report unfinished and never masquerade as completion', async t => {
  let rounds = 0;
  const config = await model(t, () => {rounds++; return {role: 'assistant', content: 'I will use the launch function.'};});
  const result = await runAgent(config, [], {list: async () => [], call: async () => {throw new Error('No tools were called');}}, undefined, true);
  assert.equal(rounds, 3);
  assert.match(result, /task is unfinished/);
});
