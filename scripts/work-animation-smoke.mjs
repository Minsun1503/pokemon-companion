import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir, mkdtemp, readFile, realpath, rm} from 'node:fs/promises';
import os from 'node:os';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const sharp = createRequire(import.meta.url)('../frontend/node_modules/sharp');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(resolve(os.tmpdir(), 'pokemon-work-animation-'));
const env = {...process.env, POKEMON_FOCUS_FIXTURE_DATA: scratch};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(resolve(root, 'frontend/node_modules/electron/dist/electron.exe'),
  [resolve(root, 'scripts/companion-focus-fixture.cjs')], {env, windowsHide:true, stdio:['ignore', 'pipe', 'inherit']});
let url;
const fixture = async path => {
  const response = await fetch(url + path, {signal:AbortSignal.timeout(5000)});
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
};
const waitAnimation = async (animation, pet) => {
  for (let read = 0; read < 80; read++) {
    const state = await fixture('/state');
    if (state.animation === animation && state.imageReady && (!pet || state.pet === pet)) return state;
    await delay(40);
  }
  throw new Error('Renderer did not show ' + animation);
};
try {
  url = await new Promise((ready, reject) => {
    const timer = setTimeout(() => reject(new Error('Animation fixture did not start.')), 15000);
    let buffer = '';
    child.stdout.on('data', chunk => {
      buffer += chunk;
      for (const line of buffer.split('\n')) try {
        const result = JSON.parse(line);
        if (result.port) {clearTimeout(timer); ready('http://127.0.0.1:' + result.port);}
      } catch {}
    });
    child.once('error', error => {clearTimeout(timer); reject(error);});
    child.once('exit', () => {clearTimeout(timer); reject(new Error('Animation fixture exited.'));});
  });
  const images = [];
  for (const pet of ['pikachu', 'riolu', 'lucario', 'clodsire', 'bulbasaur', 'charmander', 'squirtle']) {
    for (const [name, animation, badge, prop] of [['get_ui', 'thinking', 'Checking', 'scanning'], ['set_value', 'typing', 'Typing', 'keyboard'], ['invoke', 'clicking', 'Clicking', 'mouse']]) {
      await fixture(`/action?name=${name}&pet=${pet}&finished=1`);
      const state = await waitAnimation(animation, pet);
      assert.equal(state[prop], true, pet + ' must show its work prop');
      assert.equal(state.badge, badge, pet + ' must name its work even after a coalesced fast call');
      // DOM/IPC readiness precedes compositor painting; wait for the actual visual frame.
      await delay(180);
      const frame = await fixture('/frame?freezeProps=0');
      images.push(await readFile(frame.path));
      await delay(350);
      const held = await fixture('/state');
      assert.equal(held.animation, animation, pet + ' must hold fast feedback');
      assert.equal(held.badge, badge);
      assert.equal(held[prop], true);
      assert.equal(held.x, state.x, 'Work feedback must not drift across the screen');
      assert.equal(held.y, state.y);
    }
  }
  for (let read = 0; read < 60 && (await fixture('/state')).badge !== 'Ready'; read++) await delay(40);
  const idle = await fixture('/state');
  assert.equal(idle.badge, 'Ready');
  assert.equal(idle.scanning || idle.keyboard || idle.mouse, false);
  await fixture('/action?name=get_ui&busy=1');
  await waitAnimation('thinking');
  await delay(1400);
  assert.equal((await fixture('/state')).badge, 'Checking', 'Active work must last beyond the finish hold');
  await fixture('/action?name=error');
  const error = await waitAnimation('error');
  assert.equal(error.badge, 'Needs help');
  assert.equal(error.scanning || error.keyboard || error.mouse, false);
  const output = resolve(root, 'release/qa/work-animation-preview.png');
  await mkdir(dirname(output), {recursive:true});
  await sharp({create:{width:420,height:1120,channels:4,background:'#182024'}})
    .composite(await Promise.all(images.map(async (input, index) => ({input:await sharp(input).resize(120,142).png().toBuffer(),left:10 + index % 3 * 140,top:Math.floor(index / 3) * 160}))))
    .png().toFile(output);
  console.log('PASS: all seven rendered pets show distinct checking, typing and clicking props/labels; short calls stay visible, long calls stay active, errors clear work, and completion returns to Ready. Preview: ' + output);
} finally {
  if (url) await fetch(url + '/quit').catch(() => {});
  child.kill();
  const checked = await realpath(scratch);
  assert.equal(dirname(checked).toLowerCase(), (await realpath(os.tmpdir())).toLowerCase());
  await rm(checked, {recursive:true,force:true,maxRetries:10,retryDelay:100});
}
