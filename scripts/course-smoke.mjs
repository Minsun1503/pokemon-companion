import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {Client} from '../backend/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {InMemoryTransport} from '../backend/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import {createServer} from '../backend/dist/index.js';
import {PokemonRuntime} from '../backend/dist/pokemon/runtime.js';

assert.equal(process.platform, 'win32', 'This smoke test requires an unlocked Windows desktop.');
const title = `Pokemon Course Smoke ${randomUUID().slice(0, 8)}`;
const completion = 'COURSE COMPLETE: 1/1 lessons';
// Use the real MCP tools and native worker, with a presentation-only test companion.
const runtime = new PokemonRuntime({
  state: {pet: 'pikachu', activity: 'idle', message: '', task: '', visible: false, paused: false, completedActions: 0},
  async start() {}, async close() {}, async capture() {},
  async update(patch) {Object.assign(this.state, patch);},
});
const server = createServer(runtime);
const client = new Client({name: 'course-smoke', version: '1'});
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const fixture = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="en"><head><title>${title}</title>
    <style>body{font:16px sans-serif;margin:0}header{position:sticky;top:0;background:white;padding:12px}pre{white-space:pre-wrap;padding:12px}</style>
    </head><body><header><label>Search <input aria-label="Search"></label>
    <button id="next">Next lesson</button><button id="duplicate">Next lesson</button>
    <button id="remove">Remove duplicate</button><button id="oversized">Oversized lesson</button></header><pre id="lesson"></pre>
    <script>
    const lesson = document.querySelector('#lesson');
    lesson.textContent = 'LESSON ONE START\\n' + ('Vietnamese chữ, quotes " and slash \\\\ with emoji 🐱\\n').repeat(550) + 'LESSON ONE TAIL';
    document.querySelector('#next').onclick = () => setTimeout(() => {
      lesson.textContent = 'LESSON TWO READY\\nRead the whole lesson.\\n${completion}';
    }, 350);
    document.querySelector('#remove').onclick = () => document.querySelector('#duplicate').remove();
    document.querySelector('#oversized').onclick = () => {
      lesson.textContent = 'BIG LESSON READY\\n' + ('x'.repeat(5000) + '\\n').repeat(205) + '\\n${completion}';
    };
    let previous = '';
    setInterval(() => {
      const value = document.querySelector('input').value;
      if (value !== previous) {
        previous = value;
        setTimeout(() => {lesson.textContent = 'SEARCH RESULT READY: ' + value;}, 250);
      }
    }, 50);
    </script></body></html>`);
});
const call = async (name, args, expectedError = false) => {
  const result = await client.callTool({name, arguments: args});
  assert.equal(result.content.length, 1, 'Responses should contain one compact text result.');
  assert.equal(result.content[0].type, 'text', 'No screenshots should be used.');
  assert.equal(Boolean(result.isError), expectedError, result.content[0].text);
  if (name === 'course') assert(result.content[0].text.length <= (args.max_chars ?? 8000));
  return JSON.parse(result.content[0].text);
};
const windows = (args) => call('windows', args);
let windowId;
let originalActive;
let documentName;
try {
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const tools = await client.listTools();
  assert(tools.tools.some((tool) => tool.name === 'course'));
  originalActive = (await windows({action: 'get_windows'})).windows.find((win) => win.active);
  await new Promise((ready) => fixture.listen(0, '127.0.0.1', ready));
  const url = `http://127.0.0.1:${fixture.address().port}/`;
  const launched = await windows({action: 'launch', text: url, query: title, timeout_ms: 15000});
  assert.equal(launched.windows.length, 1);
  windowId = launched.windows[0].id;
  const docs = await windows({action: 'wait_for', window_id: windowId, query: title, control_type: 'Document', timeout_ms: 5000});
  assert.equal(docs.nodes.length, 1);
  await windows({action: 'focus', snapshot: docs.snapshot, element_id: docs.nodes[0].id});
  documentName = docs.nodes[0].name;
  const base = {window_id: windowId, document_name: documentName, timeout_ms: 15000};
  const course = (args, expectedError = false) => call('course', {...base, ...args}, expectedError);

  // Verify the legacy text limit now reports truncation instead of silently losing the tail.
  const legacy = await windows({action: 'read_text', snapshot: docs.snapshot, element_id: docs.nodes[0].id, max_chars: 16000});
  assert.equal(legacy.truncated, true);
  assert(!legacy.text.includes('LESSON ONE TAIL'));

  let offset = 0;
  let version;
  let reconstructed = '';
  let pages = 0;
  do {
    const page = await course({action: 'read_lesson', offset, version, page_chars: 12000, max_chars: 2000});
    assert.equal(page.ok, true);
    assert.equal(page.offset, offset);
    assert.equal(page.source_truncated, false);
    assert(page.text.length > 0, 'A bounded page must make progress.');
    assert(!/[\uD800-\uDBFF]$/.test(page.text), 'Do not cut an emoji surrogate pair.');
    reconstructed += page.text;
    version ??= page.version;
    assert.equal(page.version, version);
    pages += 1;
    if (!page.has_more) break;
    assert.equal(page.next_offset, offset + page.text.length);
    offset = page.next_offset;
  } while (pages < 100);
  assert(reconstructed.length > 8000);
  assert(reconstructed.includes('LESSON ONE TAIL'));
  assert(reconstructed.includes('🐱'));
  assert(pages < 100);

  const blocked = await course({action: 'open_lesson', navigation_name: 'Next lesson', ready_text: 'LESSON TWO READY'}, true);
  assert.equal(blocked.input_state, 'not_sent');
  assert.match(blocked.error, /Ambiguous/);
  const remove = await windows({action: 'get_ui', window_id: windowId, query: 'Remove duplicate', control_type: 'Button'});
  assert.equal(remove.nodes.length, 1);
  await windows({action: 'invoke', snapshot: remove.snapshot, element_id: remove.nodes[0].id});

  const start = performance.now();
  const opened = await course({action: 'open_lesson', navigation_name: 'Next lesson', ready_text: 'LESSON TWO READY'});
  assert.equal(opened.ok, true);
  assert.equal(opened.readiness_verified, true);
  assert.equal(opened.input_state, 'applied');
  assert.notEqual(opened.version, version);
  assert(opened.text.includes('LESSON TWO READY'));
  assert(performance.now() - start >= 250, 'Must wait for the delayed lesson text.');
  const stale = await course({action: 'read_lesson', offset: 100, version}, true);
  assert.equal(stale.input_state, 'not_sent');
  assert.match(stale.error, /text changed/);
  const complete = await course({action: 'check_completion', completion_text: completion});
  assert.equal(complete.status, 'confirmed');
  assert.equal(complete.match_count, 1);
  assert(complete.match_excerpt.includes(completion));
  const absent = await course({action: 'check_completion', completion_text: 'OTHER COURSE COMPLETE 1/1'});
  assert.equal(absent.status, 'not_found');

  const searched = await course({action: 'search_courses', search_text: 'Onboarding', ready_text: 'SEARCH RESULT READY: Onboarding'});
  assert.equal(searched.ok, true);
  assert.equal(searched.input_state, 'applied');
  assert.equal(searched.readiness_verified, true);
  assert(searched.text.includes('SEARCH RESULT READY: Onboarding'));
  const same = await course({action: 'search_courses', search_text: 'Onboarding', ready_text: 'SEARCH RESULT READY: Onboarding'});
  assert.equal(same.ok, true);
  assert.equal(same.input_state, 'not_sent');
  const after = await windows({action: 'get_windows', query: title});
  assert.equal(after.windows.length, 1, 'Search must not alter the browser address bar.');
  const cappedNavigation = await course({action: 'open_lesson', navigation_name: 'Oversized lesson', ready_text: 'BIG LESSON READY'}, true);
  assert.equal(cappedNavigation.input_state, 'applied');
  assert.match(cappedNavigation.error, /native reading bound/);
  const capped = await course({action: 'read_lesson'});
  assert.equal(capped.source_truncated, true);
  assert.equal(capped.total_characters, 1000000);
  const uncertain = await course({action: 'check_completion', completion_text: completion});
  assert.equal(uncertain.status, 'unknown');
  assert.equal(uncertain.match_count, 0);
  console.log(`PASS: course MCP registration, ${pages} native text pages beyond 8000 characters, emoji boundaries, duplicate-target rejection, delayed navigation, stale-version rejection, completion evidence, verified/idempotent search, and native source cap; no screenshots.`);
} finally {
  try {
    // Close only this uniquely named test tab, after a fresh foreground check.
    const owned = await windows({action: 'get_windows', query: title});
    if (owned.windows.length === 1) {
      const win = owned.windows[0];
      const docs = await windows({action: 'get_ui', window_id: win.id, query: title, control_type: 'Document'});
      assert.equal(docs.nodes.length, 1, 'Refuse cleanup if this test document is not uniquely active.');
      await windows({action: 'focus', snapshot: docs.snapshot, element_id: docs.nodes[0].id});
      const active = await windows({action: 'get_windows', query: title});
      assert(active.windows[0]?.active && active.windows[0]?.title.includes(title));
      await call('computer', {action: 'key', text: 'ctrl+w', window_id: win.id});
      const deadline = performance.now() + 3000;
      while ((await windows({action: 'get_windows', query: title})).windows.length) {
        assert(performance.now() < deadline, 'Owned test page did not close.');
        await delay(100);
      }
    }
    if (originalActive) {
      // Windows may deny foreground restoration even when test-tab cleanup succeeded.
      const restored = await client.callTool({name: 'windows', arguments: {action: 'activate', window_id: originalActive.id}});
      if (restored.isError) console.warn('Windows declined restoring the previous foreground window; the owned test tab was closed.');
    }
  } finally {
    await client.close();
    await server.close();
    await runtime.close();
    await new Promise((closed) => {fixture.close(closed); fixture.closeAllConnections();});
  }
}
