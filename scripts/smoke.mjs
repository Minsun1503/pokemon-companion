import assert from 'node:assert/strict';
import {connect} from './client.mjs';
const {client, call} = await connect();
try {
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), ['computer', 'pokemon', ...(process.platform === 'win32' ? ['windows'] : [])]);
  const prompts = await client.listPrompts();
  assert(prompts.prompts.some((prompt) => prompt.name === 'pokemon-work'));
  for (const pet of ['pikachu', 'riolu', 'lucario', 'clodsire', 'bulbasaur', 'charmander', 'squirtle']) {
    const result = await call('pokemon', {action: 'select', pet});
    assert.equal(result.structuredContent.pet, pet);
  }
  await call('pokemon', {action: 'select', pet: 'pikachu'});
  await call('pokemon', {action: 'task', message: 'Checking the desktop connection'});
  const screenshot = await call('computer', {action: 'get_screenshot'});
  const image = screenshot.content.find((item) => item.type === 'image');
  assert(image && image.mimeType === 'image/png');
  assert.equal(Buffer.from(image.data, 'base64').subarray(1, 4).toString(), 'PNG');
  const dimensions = JSON.parse(screenshot.content.find((item) => item.type === 'text').text);
  assert(dimensions.image_width > 0 && dimensions.image_height > 0);
  await call('computer', {action: 'get_cursor_position'});
  const done = await call('pokemon', {action: 'done', message: 'Desktop connection verified!'});
  assert.equal(done.structuredContent.completedActions, 2);
  assert.equal(done.structuredContent.activity, 'success');
  await call('pokemon', {action: 'hide'});
  const shown = await call('pokemon', {action: 'show'});
  assert.equal(shown.structuredContent.visible, true);
  console.log(`PASS: stdio handshake, ${tools.tools.length} tools, prompt, all 7 pets, real ${dimensions.image_width}×${dimensions.image_height} screenshot, cursor, lifecycle.`);
} finally { await client.close(); }
