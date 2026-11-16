const {test} = require('node:test');
const assert = require('node:assert/strict');
const {randomBytes} = require('node:crypto');
const {ScopedGrants} = require('../frontend/build/main/companion/grants.js');
const {readFileSync} = require('node:fs');
const {runInNewContext} = require('node:vm');
const {EventEmitter} = require('node:events');
const request = (change = {}) => ({action_id: 'fixture', digest: 'a'.repeat(64), scope_hash: 'b'.repeat(64), tool: 'browser', operation: 'click', target: 'Send', origin: 'https://example.test', path: '/thread/one', input_preview: 'synthetic song', input_hash: 'c'.repeat(64), state_hash: 'd'.repeat(64), target_length: 4, input_length: 14, conversation: 'Thread one', scope_allowed: true, ...change});
test('single-use grants reject replay, expired grants and changed state digests', () => {
  let time = 1;
  const grants = new ScopedGrants(randomBytes(32), () => time);
  grants.issue(request(), false);
  assert.equal(grants.consume(request({digest: 'e'.repeat(64)})), false);
  assert.equal(grants.consume(request()), true);
  assert.equal(grants.consume(request()), false);
  grants.issue(request(), false); time = 30002;
  assert.equal(grants.consume(request()), false);
});
test('standing scoped grants permit 20 uses, but reject a different conversation/action/owner/spec scope', () => {
  let time = 1;
  const grants = new ScopedGrants(randomBytes(32), () => time);
  grants.issue(request(), true);
  assert.equal(grants.consume(request({scope_hash: 'f'.repeat(64)})), false);
  for (let index = 0; index < 20; index++) assert.equal(grants.consume(request({digest: String(index).padStart(64, '0')})), true);
  assert.equal(grants.consume(request()), false);
  grants.issue(request(), true); time = 600002;
  assert.equal(grants.consume(request()), false);
});
test('HMAC tampering and revocation fail closed; grants contain hashes, never plaintext inputs', () => {
  const grants = new ScopedGrants(randomBytes(32));
  grants.issue(request(), false);
  const [grant] = grants.grants.values(); // Internal test access only; no renderer/MCP API exposes this map.
  assert(!JSON.stringify(grant).includes('synthetic song'));
  grant.remaining = 9000;
  assert.equal(grants.consume(request()), false);
  grants.issue(request(), true);
  grants.revokeAll();
  assert.equal(grants.consume(request()), false);
});

test('unknown conversations cannot issue standing grants, and scope revocation preserves only trusted reconciliation', () => {
  const grants = new ScopedGrants(randomBytes(32));
  assert.throws(() => grants.issue(request({scope_allowed: false}), true));
  grants.issue(request(), true);
  grants.revokeScope(request().scope_hash);
  assert.equal(grants.consume(request()), false);
  grants.issue(request({reconciliation: true}), false);
  assert.equal(grants.consume(request()), false);
  grants.revokeScope(request().scope_hash);
  assert.equal(grants.consume(request({reconciliation: true})), true);
});

// Isolated fake windows only. This does not operate a real approval dialog or send an MCP action.
function waitingFixture() {
  let timeout;
  class FixtureWindow extends EventEmitter {
    webContents = {setWindowOpenHandler() {}, on() {}};
    setContentProtection() {}
    async loadFile() {}
    showInactive() {}
    isVisible() {return true;}
    close() {this.emit('closed');}
  }
  const fixtureModule = {exports: {}};
  runInNewContext(readFileSync(require.resolve('../frontend/build/main/companion/approval.js'), 'utf8'), {
    module: fixtureModule, exports: fixtureModule.exports, Buffer,
    require: name => name === 'electron' ? {BrowserWindow: FixtureWindow} : name === './grants' ? {ScopedGrants} : require(name),
    setTimeout: callback => {timeout = callback; return 1;}, clearTimeout() {},
  });
  const approvals = Object.create(fixtureModule.exports.CompanionApprovals.prototype);
  Object.assign(approvals, {windows: new Map(), grants: new ScopedGrants(randomBytes(32)), protectionReady: Promise.resolve(), protect: async () => {}, root: '/synthetic-fixture'});
  return {approvals, expire: () => timeout()};
}
const ready = () => new Promise(done => setImmediate(done));
test('capture waits for a decision and consumes one human-issued fixture grant in the original request', async () => {
  const {approvals} = waitingFixture();
  const selected = request({tool: 'api', operation: 'watch_start', wait_for_decision: true, scope_allowed: false});
  let completed = false;
  const pending = approvals.check(selected).then(result => {completed = true; return result;});
  await ready();
  assert.equal(completed, false);
  approvals.decide(selected.digest, false);
  assert.equal((await pending).authorized, true);
  assert.equal(approvals.grants.consume(selected), false);
});
test('capture denial and window closure resolve without issuing or consuming a grant', async () => {
  for (const close of [false, true]) {
    const {approvals} = waitingFixture();
    const selected = request({wait_for_decision: true});
    const pending = approvals.check(selected);
    await ready();
    if (close) approvals.windows.get(selected.digest).window.close();
    else approvals.decide(selected.digest, 'deny');
    assert.equal((await pending).authorized, false);
    assert.equal(approvals.grants.consume(selected), false);
  }
});
test('an expired capture wait remains stopped and a later click requires a fresh authorization check', async () => {
  const {approvals, expire} = waitingFixture();
  const selected = request({wait_for_decision: true});
  const pending = approvals.check(selected);
  await ready();
  expire();
  assert.equal((await pending).authorized, false);
  approvals.decide(selected.digest, false);
  assert.equal((await approvals.check(selected)).authorized, true);
  assert.equal(approvals.grants.consume(selected), false);
});
