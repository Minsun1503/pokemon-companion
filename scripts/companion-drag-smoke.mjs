import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';

const {mouse, Point, Button} = createRequire(import.meta.url)('../backend/node_modules/@nut-tree-fork/nut-js');
const originalCursor = await mouse.getPosition();
let heldButton = false;
const root = process.cwd(), scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-drag-'));
const near = (actual, expected) => Math.abs(actual - expected) <= 1;
let child, url;
async function start() {
  const env = {...process.env, POKEMON_FOCUS_FIXTURE_DATA: scratch};
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.POKEMON_USER_DATA_DIR;
  child = spawn(resolve(root, 'frontend/node_modules/electron/dist/electron.exe'), [resolve(root, 'scripts/companion-focus-fixture.cjs')], {env, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit']});
  url = await new Promise((ready, reject) => {
    const timer = setTimeout(() => reject(new Error('Drag fixture did not start.')), 15000);
    let output = '';
    child.stdout.on('data', data => {
      output += data;
      for (const line of output.split('\n')) try {const result = JSON.parse(line); if (result.port) {clearTimeout(timer); ready(`http://127.0.0.1:${result.port}`);}} catch {}
    });
    child.once('error', error => {clearTimeout(timer); reject(error);});
    child.once('exit', () => {clearTimeout(timer); reject(new Error('Drag fixture exited.'));});
  });
}
async function fixture(path) {
  const response = await fetch(url + path, {signal: AbortSignal.timeout(5000)});
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
}
async function gesture(phase, x, y) {
  const point = await fixture(`/pointer-point?x=${x}&y=${y}`);
  await mouse.setPosition(new Point(point.x, point.y));
  await delay(150); // Allow the overlay's hit regions to follow the cursor.
  if (phase === 'down') {heldButton = true; await mouse.pressButton(Button.LEFT);}
  if (phase === 'up') {await mouse.releaseButton(Button.LEFT); heldButton = false;}
  await delay(80);
}
async function waitFor(accept) {
  let state;
  for (let index = 0; index < 80; index++) {state = await fixture('/state'); if (accept(state)) return state; await delay(30);}
  throw new Error(`Drag fixture state did not settle: ${JSON.stringify({...state,source:undefined,trace:await fixture('/trace')})}`);
}
async function stop() {
  const current = child;
  if (!current || current.exitCode !== null) return;
  const exited = new Promise(resolve => current.once('exit', resolve));
  await fixture('/quit'); await exited; child = undefined;
}
try {
  await start();
  await fixture('/movement?allowed=0'); await fixture('/action?name=idle');
  const parked = await waitFor(state => !state.movementAllowed && state.animation === 'idle');
  await fixture('/move?x=200&y=200'); await delay(250);
  const locked = await fixture('/state');
  assert.equal(locked.x, parked.x); assert.equal(locked.y, parked.y);
  await fixture('/action?name=set_value&busy=1');
  assert.equal((await waitFor(state => state.animation === 'typing')).x, parked.x);
  await gesture('down', parked.x + 50, parked.y + 59);
  const held = await waitFor(state => state.dragging && state.animation === 'dragging');
  assert(!held.source.endsWith('.gif'), 'Held pet must use a still pose.');
  await gesture('move', 200, 300);
  await gesture('up', 200, 300);
  const dropped = await waitFor(state => !state.dragging);
  assert(near(dropped.x, 150)); assert(near(dropped.y, 241)); // Native DPI conversion can round by one pixel.
  assert.equal(dropped.panel, false, 'Dragging must not open the actions panel.');
  const saved = await fixture('/preferences');
  assert.equal(saved.movementAllowed, false); assert(near(saved.placed.x, dropped.x)); assert(near(saved.placed.y, dropped.y));
  await stop(); await start();
  const restored = await waitFor(state => !state.movementAllowed && near(state.x, dropped.x) && near(state.y, dropped.y));
  await gesture('down', restored.x + 50, restored.y + 59);
  await gesture('up', restored.x + 50, restored.y + 59);
  assert.equal((await waitFor(state => state.panel)).panel, true, 'A normal click must still open actions.');
  await gesture('down', restored.x + 50, restored.y + 59);
  await gesture('up', restored.x + 50, restored.y + 59);
  await waitFor(state => !state.panel);
  await fixture('/movement?allowed=1'); await fixture('/resume');
  await fixture('/action?name=set_value&busy=1&x=600&y=350');
  const arrived = await waitFor(state => near(state.x, 636) && near(state.y, 374) && state.animation === 'typing');
  await fixture('/movement?allowed=0');
  await gesture('down', arrived.x + 50, arrived.y + 59);
  await gesture('move', 200, 300); await gesture('up', 200, 300);
  await waitFor(state => !state.dragging && near(state.x, 150));
  await fixture('/movement?allowed=1'); await fixture('/resume');
  await fixture('/action?name=set_value&busy=1&x=600&y=350');
  await waitFor(state => near(state.x, 636) && near(state.y, 374) && state.animation === 'typing');
  console.log('PASS: native mouse input captures and drags the Electron pet while movement is off, work animates in place, drop suppresses click, and placement/permission survive restart. Normal clicks open and close actions; movement resumes toward repeated targets after repositioning. Physical multi-monitor handoff is not covered.');
} finally {
  if (heldButton) await mouse.releaseButton(Button.LEFT);
  await mouse.setPosition(originalCursor);
  if (child?.exitCode === null) {await stop().catch(() => child?.kill());}
  const checked = await realpath(scratch);
  assert.equal(dirname(checked).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
  assert(checked.split(/[\\/]/).at(-1).startsWith('pokemon-drag-'));
  await rm(checked, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
}
