const assert = require('node:assert/strict');
const {test} = require('node:test');

async function fixture() {
  const {PokemonRuntime} = await import('../backend/dist/pokemon/runtime.js');
  const {TalkTools} = await import('../backend/dist/talk/tools.js');
  const window = {id: '123', window_ref: 'a'.repeat(32), title: 'Desktop Test', process: 'test-app'};
  let entered = '', found = false, reads = 0;
  const calls = [];
  const state = {pet: 'pikachu', activity: 'idle', message: '', task: '', visible: true, paused: false, completedActions: 0};
  const companion = {state, start: async () => {}, update: async patch => Object.assign(state, patch), capture: async () => {}, close: async () => {}};
  const desktop = {
    withControlLease: async run => run(), assertControlLease() {}, close() {},
    request: async args => {
      calls.push(args);
      if (args.action === 'launch') return {started: args.text, query: 'test-app'};
      if (args.action === 'get_windows') return {windows: [window], matched: 1, truncated: false};
      if (args.action === 'get_ui') {
        reads++;
        const nodes = found
          ? [{id: 3, role: 'Text', name: 'Found Damien', value: 'Damien'}]
          : [{id: 1, role: 'Edit', name: 'Search', value: entered, actions: ['set_value', 'focus'], targetable: true}, {id: 2, role: 'Button', name: 'Find', actions: ['invoke'], targetable: true}];
        const filtered = nodes.filter(node => !args.query || node.name.toLowerCase().includes(args.query.toLowerCase()));
        return {window, snapshot: 'b'.repeat(32), nodes: filtered, matched: filtered.length, complete: true, truncated: false};
      }
      if (args.action === 'set_value') entered = args.text;
      if (args.action === 'invoke') found = entered === 'Damien';
      return {ok: true};
    },
  };
  const tools = new TalkTools(new PokemonRuntime(companion, desktop));
  return {tools, window, calls, state, get reads() {return reads;}};
}

test('native app launch, search input, and click have no GitHub prerequisite', async () => {
  const f = await fixture();
  f.tools.begin('pikachu', 'Open this app and find Damien');
  await f.tools.call('windows', {action: 'launch', text: 'test-app.exe', query: 'test-app'}, 'pikachu');
  await f.tools.call('windows', {action: 'launch', text: 'https://example.com', query: 'test-app'}, 'pikachu');
  const ui = await f.tools.call('windows', {action: 'get_ui', window_id: f.window.id, window_ref: f.window.window_ref}, 'pikachu');
  const target = {window_id: f.window.id, window_ref: f.window.window_ref, snapshot: ui.snapshot};
  await f.tools.call('windows', {...target, action: 'set_value', element_id: 1, text: 'Damien'}, 'pikachu');
  const premature = await f.tools.call('task_done', {window_id: f.window.id, window_ref: f.window.window_ref, query: 'Search', summary: 'Found Damien'}, 'pikachu');
  assert.equal(premature.verified, undefined);
  assert.match(premature.error, /typing a query alone/);
  await f.tools.call('windows', {...target, action: 'invoke', element_id: 2}, 'pikachu');
  const previousReads = f.reads;
  const done = await f.tools.call('task_done', {window_id: f.window.id, window_ref: f.window.window_ref, query: 'Damien', summary: 'Đã tìm thấy Damien.'}, 'pikachu');
  assert.equal(done.verified, true);
  assert.equal(f.reads, previousReads + 1);
  assert.ok(f.calls.some(call => call.action === 'invoke'));
  assert.equal(done.summary, 'Đã tìm thấy Damien.');
});

test('short control targets supply exact native references and cannot cross turns or pets', async () => {
  const f = await fixture();
  f.tools.begin('pikachu', 'Find Damien');
  const ui = await f.tools.call('windows', {action: 'get_ui', window_id: f.window.id, window_ref: f.window.window_ref}, 'pikachu');
  assert.equal(ui.nodes[0].target, 'c1');
  const result = await f.tools.call('windows', {action: 'set_value', target: 'c1', text: 'Damien'}, 'pikachu');
  assert.equal(result.observation.nodes[0].value, 'Damien');
  assert.match(result.instruction, /fresh observation/);
  const applied = f.calls.findLast(call => call.action === 'set_value');
  assert.deepEqual(applied.snapshot, ui.snapshot);
  assert.equal(applied.element_id, 1);
  assert.equal(applied.window_ref, f.window.window_ref);
  await assert.rejects(f.tools.call('windows', {action: 'invoke', target: 'c1'}, 'pikachu'), /does not support/);
  await assert.rejects(f.tools.call('windows', {action: 'set_value', target: 'c1', window_id: '999', text: 'wrong'}, 'pikachu'), /conflict/);
  await assert.rejects(f.tools.call('windows', {action: 'set_value', target: 'c1', text: 'wrong'}, 'riolu'), /Unknown or expired/);
  f.tools.begin('pikachu', 'A new request');
  await assert.rejects(f.tools.call('windows', {action: 'set_value', target: 'c1', text: 'wrong'}, 'pikachu'), /Unknown or expired/);
});

test('completion evidence is fresh, scoped to the current turn and pet, and respects pause', async () => {
  const f = await fixture();
  const completion = {window_id: f.window.id, window_ref: f.window.window_ref, query: 'Find', summary: 'Done'};
  f.tools.begin('pikachu', 'Read my app');
  await assert.rejects(f.tools.call('task_done', completion, 'pikachu'), /Read this app/);
  await f.tools.call('windows', {action: 'get_ui', window_id: f.window.id, window_ref: f.window.window_ref}, 'pikachu');
  await assert.rejects(f.tools.call('task_done', completion, 'riolu'), /Read this app/);
  f.tools.begin('pikachu', 'Another task');
  await assert.rejects(f.tools.call('task_done', completion, 'pikachu'), /Read this app/);
  f.state.paused = true;
  const previous = f.calls.length;
  assert.deepEqual(await f.tools.call('windows', {action: 'invoke'}, 'pikachu'), {paused: true});
  assert.equal(f.calls.length, previous);
});
