import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {connect} from './client.mjs';

if (process.platform !== 'win32') throw new Error('This check requires Windows.');
const {client, call, root} = await connect();
const title = 'Pokémon Input Test';
let fixture;
let fixtureUrl;
try {
  const electron = resolve(root, 'frontend/node_modules/electron/dist/electron.exe');
  const env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  fixture = spawn(electron, [resolve(root, 'scripts/input-fixture/index.cjs'), '--force-renderer-accessibility'], {env, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit']});
  await new Promise((ready, reject) => {
    const timer = setTimeout(() => reject(new Error('Windows test fixture did not open.')), 15000);
    let buffer = '';
    fixture.stdout.on('data', (data) => {
      buffer += data;
      for (const line of buffer.split('\n')) {
        try { const value = JSON.parse(line); if (value.port) {fixtureUrl = `http://127.0.0.1:${value.port}`; clearTimeout(timer); ready();} } catch {}
      }
    });
    fixture.once('error', (error) => {clearTimeout(timer); reject(error);});
    fixture.once('exit', () => {clearTimeout(timer); reject(new Error('Windows test fixture exited.'));});
  });
  let screenshots = 0;
  const api = async (args) => {
    const result = await call('windows', args);
    screenshots += result.content.filter((item) => item.type === 'image').length;
    return JSON.parse(result.content.find((item) => item.type === 'text').text);
  };
  await call('pokemon', {action: 'task', message: 'Checking Windows API control without screenshots'});
  const listed = await api({action: 'get_windows', query: title});
  assert.equal(listed.windows.length, 1);
  const window_id = listed.windows[0].id;
  const editors = await api({action: 'get_ui', window_id, control_type: 'Edit'});
  assert.equal(editors.nodes.length, 1);
  assert(editors.nodes[0].actions.includes('set_value'));
  const text = 'Xin chào, mình là Pikachu! www.youtube.com';
  await api({action: 'set_value', snapshot: editors.snapshot, element_id: editors.nodes[0].id, text});
  let filled = await api({action: 'get_ui', window_id, query: 'Test note'});
  if (filled.nodes[0]?.value !== text) filled = await api({action: 'get_ui', window_id, query: 'Test note'});
  assert.equal(filled.nodes[0].value, text);
  assert.equal(filled.nodes[0].value_clipped, undefined);
  const buttons = await api({action: 'get_ui', window_id, query: 'Verify input', control_type: 'Button'});
  assert.equal(buttons.nodes.length, 1);
  await api({action: 'invoke', snapshot: buttons.snapshot, element_id: buttons.nodes[0].id});
  const fixtureState = await (await fetch(fixtureUrl)).json();
  assert.equal(fixtureState.text, text);
  assert.equal(fixtureState.clicks, 1);
  const batchText = 'One call: Pokémon APIs fill and verify!';
  const batch = await api({action: 'batch', max_chars: 2000, steps: [
    {action: 'get_windows', query: title},
    {action: 'get_ui', window_step: 0, query: 'Test note', control_type: 'Edit'},
    {action: 'set_value', target_step: 1, text: batchText},
    {action: 'get_ui', window_step: 0, query: 'Verify input', control_type: 'Button'},
    {action: 'invoke', target_step: 3},
    {action: 'get_ui', window_step: 0, query: 'Test note', control_type: 'Edit', expect_value: batchText},
  ]});
  assert.equal(batch.ok, true);
  assert.equal(batch.completed, 6);
  assert.equal(batch.result.nodes[0].value, batchText);
  assert(JSON.stringify(batch).length <= 2000);
  const batchState = await (await fetch(fixtureUrl)).json();
  assert.equal(batchState.text, batchText);
  assert.equal(batchState.clicks, 2);
  let longEditor = batch.result;
  for (const longText of ['x'.repeat(160), 'x'.repeat(161), text.repeat(12)]) {
    const changed = await api({action: 'set_value', snapshot: longEditor.snapshot, element_id: longEditor.nodes[0].id, text: longText});
    assert.equal(changed.value_clipped, changed.value.length > 160 ? true : undefined);
    const expectedPreview = longText.length > 160 ? longText.slice(0, 160) + '…' : longText;
    let preview = await api({action: 'get_ui', window_id, query: 'Test note', control_type: 'Edit'});
    if (preview.nodes[0]?.value !== expectedPreview) preview = await api({action: 'get_ui', window_id, query: 'Test note', control_type: 'Edit'});
    assert.equal(preview.truncated, false);
    assert.equal(preview.nodes[0].value, expectedPreview);
    assert.equal(preview.nodes[0].value_clipped, longText.length > 160 ? true : undefined);
    const full = await api({action: 'read_text', snapshot: preview.snapshot, element_id: preview.nodes[0].id});
    assert.equal(full.text, longText);
    longEditor = preview;
  }
  const small = await api({action: 'get_ui', window_id, max_elements: 1, max_chars: 1000});
  assert.equal(small.nodes.length, 1);
  assert.equal(small.truncated, true);
  assert(JSON.stringify(small).length <= 1000);
  await assert.rejects(api({action: 'invoke', snapshot: '0'.repeat(32), element_id: 1}), /Unknown or expired/);
  assert.equal(screenshots, 0);
  await call('pokemon', {action: 'done', message: 'Windows API reading, typing, and buttons verified!'});
  console.log(`PASS: 6 sequential Windows API steps in 1 MCP call (${JSON.stringify(batch).length} response characters), verified field value and button click, clipping flags at 160/161 characters and full read_text, atomic compatibility, Unicode, stale-id rejection, bounded responses, zero screenshot images.`);
} finally {
  if (fixtureUrl) await fetch(`${fixtureUrl}/quit`, {method: 'POST'}).catch(() => {});
  fixture?.kill();
  await client.close();
}
