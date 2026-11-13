const assert = require('node:assert/strict');
const {test} = require('node:test');
const {registerCompanionChat} = require('../frontend/build/main/companion/chat-ipc.js');

test('Talk IPC serves history and replies only to an owned main frame', async () => {
  const handlers = new Map();
  const calls = [];
  const owned = {mainFrame: {}};
  const other = {mainFrame: {}};
  registerCompanionChat({handle: (name, handler) => handlers.set(name, handler)}, {
    history: pet => {calls.push(['history', pet]); return [{role: 'assistant', content: 'Saved reply'}];},
    reply: async (pet, text) => {calls.push(['reply', pet, text]); return {ok: true, content: 'Reply'};},
  }, sender => sender === owned);
  const history = handlers.get('companion:chat-history');
  const reply = handlers.get('companion:chat-send');
  for (const event of [{sender: other, senderFrame: other.mainFrame}, {sender: owned, senderFrame: {}}]) {
    assert.throws(() => history(event, 'pikachu'), /companion window/);
    assert.equal((await reply(event, 'pikachu', 'Open Excel')).ok, false);
  }
  assert.deepEqual(calls, [], 'An untrusted caller must never load history or start a task.');
  const event = {sender: owned, senderFrame: owned.mainFrame};
  assert.throws(() => history(event, {}), /companion window/);
  assert.equal((await reply(event, {}, 'Open Excel')).ok, false);
  assert.deepEqual(history(event, 'pikachu'), [{role: 'assistant', content: 'Saved reply'}]);
  assert.deepEqual(await reply(event, 'pikachu', 'Hello'), {ok: true, content: 'Reply'});
  assert.deepEqual(calls, [['history', 'pikachu'], ['reply', 'pikachu', 'Hello']]);
});
