import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {connect} from './client.mjs';
const {client, call, root} = await connect();
let child;
let url;
try {
  await call('pokemon', {action: 'task', message: 'Writing a note in a test window'});
  const electron = resolve(root, 'frontend/node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
  const env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electron, [resolve(root, 'scripts/input-fixture/index.cjs')], {env, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit']});
  const port = await new Promise((resolvePort, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test window did not start.')), 15000);
    let buffer = '';
    child.stdout.on('data', (data) => {
      buffer += data;
      for (const line of buffer.split('\n')) {
        try { const value = JSON.parse(line); if (value.port) { clearTimeout(timeout); resolvePort(value.port); } } catch {}
      }
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Test window exited.')));
  });
  url = `http://127.0.0.1:${port}`;
  const read = async () => (await fetch(url + '/state')).json();
  await fetch(`${url}/focus`, {method: 'POST'});
  const screenshot = await call('computer', {action: 'get_screenshot'});
  const imageSize = JSON.parse(screenshot.content.find((item) => item.type === 'text').text);
  const fixture = await read();
  assert.equal(fixture.focused, true);
  const coordinate = (point) => [Math.round(point.x / fixture.size.width * imageSize.image_width), Math.round(point.y / fixture.size.height * imageSize.image_height)];
  await call('computer', {action: 'left_click', coordinate: coordinate(fixture.input)});
  await call('computer', {action: 'type', text: 'Pikachu is working!'});
  await call('computer', {action: 'key', text: 'Control_L+a'});
  const plain = 'qjzx '.repeat(100);
  const typeResult = await call('computer', {action: 'type', text: plain});
  const typeDetails = JSON.parse(typeResult.content.find(item => item.type === 'text').text);
  assert.equal(typeDetails.verify, 'read the field to confirm the text; an active input method can alter letters');
  if (process.platform === 'win32') {
    assert.match(typeDetails.input_method.keyboard_layout, /^[0-9A-F]{8}$/);
    assert.match(typeDetails.input_method.language_id, /^[0-9A-F]{4}$/);
    assert.equal(typeof typeDetails.input_method.imm_ime, 'boolean');
  }
  let typed = await read();
  const deadline = Date.now() + 1000;
  while (typed.text !== plain && Date.now() < deadline) {
    await delay(10);
    typed = await read();
  }
  assert.equal(typed.text, plain);
  await call('computer', {action: 'key', text: 'Control_L+a'});
  await call('computer', {action: 'type', text: 'All seven Pokémon are ready. Xin chào, mình là Pikachu!'});
  await call('computer', {action: 'left_click', coordinate: coordinate(fixture.button)});
  await call('computer', {action: 'get_screenshot'});
  const result = await read();
  assert.equal(result.text, 'All seven Pokémon are ready. Xin chào, mình là Pikachu!');
  assert.equal(result.clicks, 1);
  await call('pokemon', {action: 'done', message: 'Typing, keyboard shortcuts, and clicks verified!'});
  console.log('PASS: 500 plain ASCII characters, Unicode/Vietnamese text replacement, keyboard shortcuts, and a button click verified through real MCP computer input.');
} finally {
  if (url) await fetch(`${url}/quit`, {method: 'POST'}).catch(() => {});
  child?.kill();
  await client.close();
}
