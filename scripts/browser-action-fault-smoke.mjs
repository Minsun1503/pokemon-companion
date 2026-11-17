import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, sep} from 'node:path';
import {BrowserAutomation} from '../backend/dist/browser/automation.js';

const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-send-fault-'));
process.env.POKEMON_ACTIONS_DIR = resolve(scratch, 'actions');
process.env.POKEMON_BROWSER_INPUT = 'host-authorized'; // Operator-owned synthetic harness; no real account.
const browser = new BrowserAutomation();
const counts = new Map();
const active = new Map();
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture');
  const run = url.searchParams.get('run');
  if (url.pathname === '/send') {
    counts.set(run, (counts.get(run) ?? 0) + 1);
    // The operation was accepted; drop the page transport before a result/navigation arrives.
    void active.get(run)?.close();
    return;
  }
  response.setHeader('content-type', 'text/html');
  response.end(`<title>Fault fixture</title><h2 id="thread" data-conversation-id="${run}">Run ${run}</h2><form id="composer" method="post" action="/send?run=${run}"><input name="message" value="synthetic song"><button id="send">Send</button></form>`);
});
await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
const origin = `http://127.0.0.1:${server.address().port}`;
const rows = [];
try {
  const opened = await browser.launch('chromium', true, resolve(scratch, 'profile'));
  const context = browser.page(opened.page_id).context();
  for (let index = 0; index < 20; index++) {
    const run = String(index);
    const page = await context.newPage();
    active.set(run, page);
    const pageId = browser.remember(page);
    browser.setConversationContract(pageId, {conversation: '#thread', composer: '#composer'});
    await page.goto(`${origin}/fixture?run=${run}`);
    const snapshot = await browser.snapshot(pageId, 'Send');
    const send = snapshot.nodes.find(node => node.id === 'send');
    assert(send);
    let outcome;
    try {outcome = (await browser.input(pageId, send.ref, 'click')).outcome;}
    catch (error) {assert.equal(error.details?.code, 'ACTION_OUTCOME_UNKNOWN'); outcome = 'unknown';}
    assert.equal(outcome, 'unknown');
    assert.equal(counts.get(run), 1);
    const restored = await context.newPage();
    const restoredId = browser.remember(restored);
    browser.setConversationContract(restoredId, {conversation: '#thread', composer: '#composer'});
    await restored.goto(`${origin}/fixture?run=${run}`);
    const fresh = await browser.snapshot(restoredId, 'Send');
    await assert.rejects(browser.input(restoredId, fresh.nodes.find(node => node.id === 'send').ref, 'click'), error => error.details?.code === 'REPLAY_BLOCKED');
    assert.equal(counts.get(run), 1);
    rows.push({run: index + 1, outcome, replay: 'blocked', readback_send_count: counts.get(run)});
    await restored.close();
  }
  const report = {at: new Date().toISOString(), fixture_only: true, runs: rows.length, accepted_sends: [...counts.values()].reduce((sum, count) => sum + count, 0), duplicate_sends: 0, rows};
  await writeFile(new URL('../benchmarks/results/claude-review-fault-2026-11-15.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({runs: report.runs, accepted_sends: report.accepted_sends, duplicate_sends: 0}));
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolveDone => server.close(resolveDone));
  assert(scratch.startsWith(resolve(tmpdir()) + sep) && scratch.includes('pokemon-send-fault-'));
  await rm(scratch, {recursive: true, force: true});
}
