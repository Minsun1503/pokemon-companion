const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const root = path.resolve(__dirname, '../frontend');
const {CompanionChat} = require('../frontend/build/main/companion/chat.js');
const {PetRegistry} = require('../frontend/build/main/services/pet-registry.js');

test('companion chat streams replies, scopes history, and recovers from provider failures', {timeout: 10000}, async (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pokemon-chat-test-'));
  // Cleanup is limited to the exact disposable directory created above.
  assert.equal(path.dirname(userData), path.resolve(os.tmpdir()));
  t.after(() => fs.rmSync(userData, {recursive: true, force: true}));
  let requestBody;
  let fail = false;
  let release;
  const server = http.createServer(async (req, res) => {
    assert.equal(req.url, '/api/chat');
    assert.equal(req.method, 'POST');
    let body = '';
    for await (const chunk of req) body += chunk;
    requestBody = JSON.parse(body);
    if (fail) {
      res.writeHead(503);
      res.end();
      return;
    }
    if (release) await new Promise((resolve) => { release.resolve = resolve; });
    res.writeHead(200, {'Content-Type': 'application/x-ndjson'});
    res.write(JSON.stringify({message: {content: '<think>private reasoning</think>Xin '}}) + '\n');
    res.end(JSON.stringify({message: {content: 'chào!'}, done: true}) + '\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {server.close(resolve); server.closeAllConnections();}));
  const settings = JSON.parse(fs.readFileSync(path.join(root, 'config/setting.json'), 'utf8'));
  settings.ai.provider = 'ollama';
  settings.ai.ollama.baseUrl = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(path.join(userData, 'setting.json'), JSON.stringify(settings));
  const pets = new PetRegistry(path.join(root, 'pets'));
  const chat = new CompanionChat(root, userData, pets);

  assert.deepEqual(chat.history('pikachu'), []);
  assert.equal((await chat.reply('pikachu', ' ')).ok, false);
  assert.equal((await chat.reply('pikachu', 'a'.repeat(4001))).ok, false);
  assert.deepEqual(await chat.reply('pikachu', 'Xin chào'), {ok: true, content: 'Xin chào!'});
  assert.equal(requestBody.stream, true);
  assert.equal(requestBody.model, settings.ai.ollama.model);
  assert.match(requestBody.messages[0].content, /Reply in the user's language/);
  assert.match(requestBody.messages.at(-1).content, /Xin chào/);
  assert.deepEqual(chat.history('pikachu'), [
    {role: 'user', content: 'Xin chào'},
    {role: 'assistant', content: 'Xin chào!'},
  ]);
  assert.deepEqual(chat.history('riolu'), []);
  assert.equal((await chat.reply('riolu', 'Hello')).ok, true);
  assert.equal(new CompanionChat(root, userData, pets).history('pikachu').length, 2);
  assert.equal(chat.history('riolu').length, 2);

  fail = true;
  const failure = await chat.reply('pikachu', 'Try again');
  assert.equal(failure.ok, false);
  assert.match(failure.error, /503/);
  assert.equal(chat.history('pikachu').length, 2);
  fail = false;

  release = {};
  const pending = chat.reply('pikachu', 'One at a time');
  while (!release.resolve) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.match((await chat.reply('pikachu', 'Duplicate')).error, /still replying/);
  release.resolve();
  release = undefined;
  assert.equal((await pending).ok, true);
  assert.equal(chat.history('pikachu').length, 4);
});
