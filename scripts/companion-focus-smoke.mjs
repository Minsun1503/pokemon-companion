import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import os from 'node:os';
import {dirname, resolve} from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {connect} from './client.mjs';

assert.equal(process.platform, 'win32');
const session = await connect({env: {...process.env, POKEMON_UI: 'off'}});
const scratch = await mkdtemp(resolve(os.tmpdir(), 'pokemon-focus-'));
const env = {...process.env, POKEMON_FOCUS_FIXTURE_DATA: scratch};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(resolve(session.root, 'frontend/node_modules/electron/dist/electron.exe'), [resolve(session.root, 'scripts/companion-focus-fixture.cjs'), '--force-renderer-accessibility'], {env, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit']});
let url, originalCursor;
const api = async args => JSON.parse((await session.call('windows', args)).content[0].text);
const {mouse} = createRequire(import.meta.url)('../backend/node_modules/@nut-tree-fork/nut-js');
const fixture = async path => {
  const response = await fetch(url + path, {signal: AbortSignal.timeout(5000)});
  const state = await response.json();
  assert.equal(response.status, 200, JSON.stringify(state));
  return state;
};
const hitWindow = point => {
  const script = `$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HitTest {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  public static Point Cursor() { Point point; GetCursorPos(out point); return point; }
  public static string Root(int x, int y) { return GetAncestor(WindowFromPoint(new Point {X=x,Y=y}), 3).ToInt64().ToString(); }
}
'@
$previous = [HitTest]::Cursor()
if (![HitTest]::SetCursorPos(${point.x}, ${point.y})) { throw 'Unable to move to the fixture button.' }
Start-Sleep -Milliseconds 200
@{root=[HitTest]::Root(${point.x}, ${point.y});previous=@{x=$previous.X;y=$previous.Y}} | ConvertTo-Json -Compress`;
  const result = JSON.parse(execFileSync(resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {windowsHide: true, encoding: 'utf8'}));
  originalCursor ??= result.previous;
  return result.root;
};
try {
  url = await new Promise((ready, reject) => {
    const timer = setTimeout(() => reject(new Error('Focus fixture did not start.')), 15000);
    let buffer = '';
    child.stdout.on('data', chunk => {
      buffer += chunk;
      for (const line of buffer.split('\n')) try {const result = JSON.parse(line); if (result.port) {clearTimeout(timer); ready('http://127.0.0.1:' + result.port);}} catch {}
    });
    child.once('error', error => {clearTimeout(timer); reject(error);});
    child.once('exit', () => {clearTimeout(timer); reject(new Error('Focus fixture exited.'));});
  });
  const input = (await api({action: 'get_windows', query: 'Pokemon Focus Input'})).windows;
  assert.equal(input.length, 1);
  if (!(await fixture('/state')).focused) {
    assert.equal(hitWindow((await fixture('/state')).point), input[0].id);
    await mouse.leftClick(); // Owned fixture gesture satisfies Windows' foreground restriction.
    await delay(100);
  }
  await api({action: 'batch', steps: [
    {action: 'get_ui', window_id: input[0].id, query: 'Background button', control_type: 'Button'},
    {action: 'focus', target_step: 0},
  ]});
  let before;
  for (let attempt = 0; attempt < 30; attempt++) {
    before = await fixture('/state');
    if (before.focused) break;
    await delay(50);
  }
  assert.equal(before.focused, true);
  for (let run = 0; run < 4; run += 1) {
    await fixture('/move?x=' + (run % 2 ? 900 : 600) + '&y=450');
    await delay(200);
    assert.equal((await fixture('/state')).focused, true, 'Moving the Pokémon must not steal app focus.');
    assert.equal(hitWindow((await fixture('/state')).point), input[0].id, 'The transparent overlay must not intercept background button clicks.');
    await session.call('computer', {action: 'key', text: 'f8', window_id: input[0].id});
    await session.call('computer', {action: 'key', text: 'Return', window_id: input[0].id});
  }
  const after = await fixture('/state');
  assert.notEqual(after.x, before.x, 'The pet must actually move during the input checks.');
  assert.equal(after.keys - before.keys, 4);
  assert.equal(after.clicks - before.clicks, 4);
  const covered = await fixture('/cover-bubble');
  assert.equal(hitWindow(covered.point), input[0].id, 'Decorative speech bubbles must pass clicks through to the app below.');
  assert.equal(after.petFocusable, false, 'Only the open Pokémon panel may accept keyboard focus.');
  const waitAnimation = async expected => {
    for (let read = 0; read < 60; read++) {
      const current = await fixture('/state');
      if (current.animation === expected && current.imageReady) return current;
      await delay(50);
    }
    throw new Error(`Pikachu did not show ${expected}.`);
  };
  await fixture('/action?name=type&busy=1');
  const typing = await waitAnimation('typing');
  assert.match(typing.source, /typing\.gif$/);
  assert.equal(typing.keyboard, true);
  assert.equal(typing.mouse, false);
  const frames = new Set();
  for (let frame = 0; frame < 10; frame++) {
    frames.add((await fixture('/frame')).hash);
    await delay(100);
  }
  assert.ok(frames.size >= 4, 'The rendered GIF must show different paw poses, not a frozen first frame.');
  assert.equal((await fixture('/state')).focused, true);
  await fixture('/action?name=type&x=900&y=100');
  const running = await waitAnimation('run');
  assert.match(running.source, /run_back\.gif$/);
  assert.equal(running.keyboard, false, 'Pikachu must run during travel, then use the keyboard after arriving.');
  await waitAnimation('typing');
  await fixture('/action?name=left_click');
  const clicking = await waitAnimation('clicking');
  assert.equal(clicking.keyboard, false);
  assert.equal(clicking.mouse, true);
  await fixture('/action?name=get_ui');
  const checking = await waitAnimation('thinking');
  assert.match(checking.source, /thinking\.gif$/);
  assert.equal(checking.scanning, true);
  assert.equal(checking.badge, 'Checking');
  for (const pet of ['pikachu', 'riolu', 'lucario', 'clodsire', 'bulbasaur', 'charmander', 'squirtle', 'hello-kitty', 'kuromi']) {
    for (const [action, animation, badge, prop] of [['get_ui', 'thinking', 'Checking', 'scanning'], ['set_value', 'typing', 'Typing', 'keyboard'], ['invoke', 'clicking', 'Clicking', 'mouse']]) {
      await fixture(`/action?name=${action}&pet=${pet}&finished=1`);
      const working = await waitAnimation(animation);
      assert.equal(working[prop], !['hello-kitty', 'kuromi'].includes(pet), pet + ' must avoid duplicating props already drawn in its sprites');
      assert.equal(working.badge, badge, pet + ' must name the current work');
      await delay(350);
      assert.equal((await fixture('/state')).animation, animation, pet + ' must keep a completed fast call visible');
      assert.equal((await fixture('/state')).focused, true, 'Work feedback must not take keyboard focus');
    }
  }
  await fixture('/action?name=idle&pet=pikachu');
  await waitAnimation('idle');
  await fixture('/action?name=success');
  assert.match((await waitAnimation('success')).source, /success\.gif$/);
  await fixture('/action?name=error');
  assert.match((await waitAnimation('error')).source, /error\.gif$/);
  await fixture('/action?name=idle');
  const overlay = (await api({action: 'get_windows', query: 'Pokemon Focus Overlay'})).windows;
  assert.equal(overlay.length, 1);
  await api({action: 'batch', steps: [
    {action: 'get_ui', window_id: overlay[0].id, query: 'Open Pokémon actions', control_type: 'Button'},
    {action: 'expand', target_step: 0},
    {action: 'wait_for', window_id: overlay[0].id, query: 'Allow movement', control_type: 'CheckBox'},
    {action: 'focus', target_step: 2},
  ]});
  assert.equal((await fixture('/state')).petFocusable, true);
  assert.ok(!(await waitAnimation('paused')).source.endsWith('.gif'), 'Opening actions during a task pauses the companion.');
  const allowed = (await fixture('/state')).movementAllowed;
  await session.call('computer', {action: 'key', text: 'space', window_id: overlay[0].id});
  await delay(100);
  assert.equal((await fixture('/state')).movementAllowed, !allowed, 'The movement checkbox must accept keyboard input.');
  await api({action: 'batch', steps: [
    {action: 'get_ui', window_id: overlay[0].id, query: 'Close panel', control_type: 'Button'},
    {action: 'invoke', target_step: 0},
  ]});
  await delay(100);
  const closed = await fixture('/state');
  assert.equal(closed.panel, false);
  assert.equal(closed.petFocused, false);
  assert.equal(closed.petFocusable, false);
  console.log('PASS: all nine companions showed checking, typing and clicking props and labels after fast calls; moving companions retained background focus, keyboard and button input; native hit-testing passed through the overlay; Pikachu GIFs animated; movement checkbox accepted keyboard input and closing released focus. No desktop screenshots; animation frames were captured from the test renderer.');
} finally {
  if (url) await fetch(url + '/quit').catch(() => {});
  child.kill();
  await session.client.close();
  if (originalCursor) hitWindow(originalCursor);
  const checked = await realpath(scratch);
  assert.equal(dirname(checked).toLowerCase(), (await realpath(os.tmpdir())).toLowerCase());
  await rm(checked, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
}
