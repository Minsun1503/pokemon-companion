import assert from 'node:assert/strict';
import {mkdir, writeFile, mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {connect} from './client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = {runs: 3, query: 'Rick Astley Never Gonna Give You Up', output: 'benchmarks/results/playwright-windows-youtube-2026-11-14.json'};
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i].slice(2), value = process.argv[i + 1];
  if (!['runs', 'query', 'output'].includes(name) || !value) throw new Error('Use --runs N --query song --output file.');
  options[name] = name === 'runs' ? Number(value) : value;
}
assert(Number.isInteger(options.runs) && options.runs > 0 && options.runs <= 10);
const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-dom-benchmark-'));
const output = resolve(root, options.output);
const report = {schema_version: 1, at: new Date().toISOString(), query: options.query, environment: {platform: process.platform, node: process.version},
  methodology: 'Alternating method order; a new visible Edge profile per sample. Both methods use browser.launch for identical startup. Interaction begins on about:blank. Playwright uses only browser MCP DOM refs; Windows uses Win32 window discovery, UIA fields and guarded Return. Completion requires a matching results URL, the exact search value and named video results. No playback. Startup, interaction, MCP calls and DOM/controls extraction reported separately. Local MCP calls include tool overhead but exclude LLM reasoning latency.', samples: []};
let session, taskId, sample, launched;
const decode = result => result.structuredContent ?? JSON.parse(result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'));
async function call(tool, args) {
  const start = performance.now();
  try {return decode(await session.call(tool, {...args, ...(taskId ? {task_id: taskId} : {})}));}
  finally {sample?.calls.push({tool, action: args.action ?? 'batch', duration_ms: performance.now() - start});}
}
const checkpoint = async () => {await mkdir(dirname(output), {recursive: true}); await writeFile(output, JSON.stringify(report, null, 2) + '\n');};
async function poll(run, ready, timeout = 20000) {
  const deadline = performance.now() + timeout;
  let last;
  do {last = await run(); if (ready(last)) return last; await delay(100);} while (performance.now() < deadline);
  throw new Error('Readiness timed out: ' + JSON.stringify(last).slice(0, 1200));
}
async function stage(name, run) {
  const started = performance.now();
  console.log(`${sample.method} run ${sample.run}: ${name}`);
  try {return await run();} catch (error) {sample.failed_stage = name; throw error;}
  finally {sample.stage_ms[name] = performance.now() - started;}
}
const target = (ui, node) => ({window_id: ui.window.id, window_ref: ui.window.window_ref, snapshot: ui.snapshot, element_id: node.id});
function unique(ui, name, action) {
  assert(ui.complete && !ui.truncated, 'Incomplete Windows discovery.');
  const nodes = ui.nodes.filter(node => node.name === name && node.targetable && node.actions?.includes(action));
  assert.equal(nodes.length, 1, 'Ambiguous Windows control ' + name + ': ' + JSON.stringify(ui).slice(0, 800));
  return nodes[0];
}
function domUnique(ui, test) {const nodes = ui.nodes.filter(test); assert.equal(nodes.length, 1, 'Ambiguous DOM control: ' + JSON.stringify(nodes)); return nodes[0];}
async function domSearch(pageId) {
  await stage('navigate_and_identify', async () => {
    await call('browser', {action: 'navigate', page_id: pageId, url: 'https://www.youtube.com/?hl=en'});
    return poll(() => call('browser', {action: 'snapshot', page_id: pageId, query: 'Search', max_elements: 100, max_chars: 1000}),
      ui => ui.nodes.some(node => node.tag === 'input' && node.name === 'Search'));
  });
  await stage('fill_and_submit', async () => {
    const ui = await call('browser', {action: 'snapshot', page_id: pageId, query: 'Search', max_chars: 1000});
    const input = domUnique(ui, node => node.tag === 'input' && node.name === 'Search');
    const filled = await call('browser', {action: 'fill', page_id: pageId, ref: input.ref, text: options.query});
    assert(filled.verified);
    const buttons = await call('browser', {action: 'snapshot', page_id: pageId, query: 'Search', max_chars: 1000});
    const submit = domUnique(buttons, node => node.tag === 'button' && node.name === 'Search');
    await call('browser', {action: 'click', page_id: pageId, ref: submit.ref});
  });
  return stage('verify_and_read_results', async () => poll(() => call('browser', {action: 'snapshot', page_id: pageId, query: 'Never Gonna', max_chars: 1000}),
    ui => new URL(ui.url).pathname === '/results' && new URL(ui.url).searchParams.get('search_query') === options.query
      && ui.nodes.some(node => node.role === 'link' && node.name.includes('Never Gonna'))));
}
async function windowsSearch(pageId) {
  let win;
  assert(launched.page_id === pageId);
  const listed = await call('windows', {action: 'get_windows', query: 'msedge'});
  // Dedicated about:blank window, with no other about:blank Edge windows in this test.
  const candidates = listed.windows.filter(window => /^about:blank|^New tab|^Untitled/i.test(window.title));
  assert.equal(candidates.length, 1, 'Cannot uniquely identify the dedicated Edge benchmark window: ' + JSON.stringify(listed));
  win = candidates[0];
  const window = {window_id: win.id, window_ref: win.window_ref};
  await call('windows', {action: 'activate', ...window});
  sample.window = window;
  await stage('navigate_and_identify', async () => {
    const ui = await call('windows', {action: 'get_ui', ...window, query: 'Address and search bar', control_type: 'Edit'});
    const node = unique(ui, 'Address and search bar', 'set_value');
    const url = 'https://www.youtube.com/?hl=en';
    await call('windows', {steps: [{action: 'focus', ...target(ui, node)}, {action: 'set_value', ...target(ui, node), text: url},
      {action: 'read_text', ...target(ui, node), expect_text: url, timeout_ms: 5000}]});
    await call('computer', {action: 'key', text: 'Return', ...window});
    const document = await poll(() => call('windows', {action: 'get_ui', ...window, query: 'YouTube', control_type: 'Document'}), ui => ui.complete && ui.nodes.length === 1);
    await call('windows', {action: 'focus', ...target(document, unique(document, document.nodes[0].name, 'focus'))});
    return poll(() => call('windows', {action: 'get_ui', ...window, query: 'Search'}),
      ui => ui.complete && ui.nodes.some(node => node.name === 'Search' && node.actions?.includes('set_value')));
  });
  await stage('fill_and_submit', async () => {
    const ui = await call('windows', {action: 'get_ui', ...window, query: 'Search'});
    const node = unique(ui, 'Search', 'set_value');
    await call('windows', {steps: [{action: 'set_value', ...target(ui, node), text: options.query},
      {action: 'read_text', ...target(ui, node), expect_text: options.query, timeout_ms: 5000}]});
    const buttons = await call('windows', {action: 'get_ui', ...window, query: 'Search', control_type: 'Button'});
    await call('windows', {action: 'invoke', ...target(buttons, unique(buttons, 'Search', 'invoke'))});
  });
  return stage('verify_and_read_results', async () => {
    const result = await poll(() => call('windows', {action: 'get_ui', ...window, query: 'Never Gonna', control_type: 'Hyperlink', max_elements: 100, max_chars: 16000}),
      ui => ui.complete && !ui.truncated && ui.nodes.some(node => node.name.includes('Never Gonna')));
    const address = await call('windows', {action: 'get_ui', ...window, query: 'Address and search bar', control_type: 'Edit'});
    const value = await call('windows', {action: 'read_text', ...target(address, unique(address, 'Address and search bar', 'read_text'))});
    const url = new URL(value.text);
    assert.equal(url.pathname, '/results'); assert.equal(url.searchParams.get('search_query'), options.query);
    return result;
  });
}
try {
  const mcpStart = performance.now();
  session = await connect({env: {...process.env, POKEMON_UI: 'on', APPDATA: resolve(scratch, 'appdata'), POKEMON_LEARNING_DIR: resolve(scratch, 'learning')}});
  report.mcp_start_ms = performance.now() - mcpStart;
  const status = await call('learning', {action: 'status'});
  if (status.enabled) {
    const task = await call('learning', {action: 'begin', query: 'Benchmark Playwright DOM against Windows APIs on YouTube by searching for a song.', parameters: {song: options.query, browser: 'Microsoft Edge'}});
    taskId = task.task_id;
  }
  await call('pokemon', {action: 'task', message: 'Comparing Playwright and Windows on YouTube song search'});
  for (let run = 1; run <= options.runs; run++) {
    const order = run % 2 ? ['playwright', 'windows'] : ['windows', 'playwright'];
    for (const method of order) {
      sample = {run, method, verified: false, stage_ms: {}, calls: []}; report.samples.push(sample);
      try {
        launched = await stage('shared_browser_startup', () => call('browser', {action: 'launch', channel: 'msedge', profile: resolve(scratch, `${method}-${run}`)}));
        const start = performance.now();
        const results = method === 'playwright' ? await domSearch(launched.page_id) : await windowsSearch(launched.page_id);
        sample.interaction_ms = performance.now() - start;
        sample.result_names = results.nodes.filter(node => method === 'windows' || node.role === 'link').map(node => node.name).slice(0, 5);
        assert(sample.result_names.length);
        sample.verified = true;
        // End-to-end includes identical browser startup but excludes teardown.
        sample.total_ms = sample.stage_ms.shared_browser_startup + sample.interaction_ms;
        console.log(`Verified ${method}: ${sample.interaction_ms.toFixed(1)} ms interaction`);
      } catch (error) {sample.error = error.message; console.error(error.message);}
      finally {
        if (launched) await call('browser', {action: 'close', session_id: launched.session_id}).catch(error => {sample.cleanup_error = error.message;});
        launched = undefined;
        await checkpoint();
      }
    }
  }
  const median = numbers => {const sorted = [...numbers].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;};
  report.summary = Object.fromEntries(['playwright', 'windows'].map(method => {
    const samples = report.samples.filter(item => item.method === method && item.verified);
    return [method, {verified: samples.length, attempted: options.runs, median_interaction_ms: samples.length ? median(samples.map(item => item.interaction_ms)) : null,
      median_total_ms: samples.length ? median(samples.map(item => item.total_ms)) : null,
      median_shared_startup_ms: samples.length ? median(samples.map(item => item.stage_ms.shared_browser_startup)) : null,
      median_tool_calls: samples.length ? median(samples.map(item => item.calls.length - 2)) : null}];
  }));
  const allVerified = report.samples.every(item => item.verified);
  await call('pokemon', {action: allVerified ? 'done' : 'error', message: allVerified ? 'Verified all six YouTube song searches' : 'Comparison saved with failed runs'});
  if (taskId) await call('learning', {action: 'finish', task_id: taskId, outcome: allVerified ? 'met' : 'unmet', satisfaction: 'unknown', summary: 'Compared DOM and native/UIA YouTube song searches; verified results and saved timings.'});
  report.built_sha256 = Object.fromEntries(await Promise.all(['browser/automation.js', 'tools/browser.js', 'windows/uia-worker.dll'].map(async path => [path, createHash('sha256').update(await readFile(resolve(root, 'backend/dist', path))).digest('hex')])));
  await checkpoint(); console.log(JSON.stringify(report.summary, null, 2));
  if (!allVerified) process.exitCode = 1;
} finally {await session?.client.close();}
