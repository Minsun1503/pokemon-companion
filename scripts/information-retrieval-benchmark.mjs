import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {execFileSync} from 'node:child_process';
import {connect} from './client.mjs';
import {distribution} from './youtube-benchmark-lib.mjs';
import {WindowsAutomation} from '../backend/dist/windows/automation.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = {runs: 5, modes: ['page_scan'], output: 'benchmarks/results/information-retrieval-baseline-2026-11-13.json', live: false};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--live') options.live = true;
  else if (process.argv[i] === '--verify') options.verify = true;
  else if (process.argv[i] === '--runs') options.runs = Number(process.argv[++i]);
  else if (process.argv[i] === '--modes') options.modes = process.argv[++i].split(',');
  else if (process.argv[i] === '--output') options.output = process.argv[++i];
  else if (process.argv[i] === '--window-id') options.windowId = process.argv[++i];
  else throw new Error('Use --runs 5 --modes page_scan,range_single,range_many --output results.json [--live] [--verify] [--window-id ID].');
}
assert.equal(process.platform, 'win32');
assert(Number.isInteger(options.runs) && options.runs >= 1 && options.runs <= 50);
assert(options.modes.length && options.modes.every(mode => ['page_scan', 'range_single', 'range_many'].includes(mode)));
assert(options.output.endsWith('.json'));
const output = resolve(root, options.output);
const nonce = randomUUID().slice(0, 8), title = 'Information Retrieval ' + nonce;
const sources = [
  {query: 'cross-process communication', fact: 'The data can then be accessed without further cross-process communication.',
    url: 'https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/caching-in-ui-automation-clients'},
  {query: 'readyState only concerns itself', fact: 'The readyState only concerns itself with loading assets defined in the HTML',
    url: 'https://www.selenium.dev/documentation/webdriver/waits/'},
  {query: 'encompasses the string', fact: 'returns a new text range that encompasses the string.',
    url: 'https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-usingtextrangeobjects'},
];
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const cases = [12000, 48000].map(size => {
  const paragraphs = Array.from({length: Math.ceil(size / 240)}, (_, i) => '<p>' + escape(('Background paragraph ' + i + '. Supporting technical material without the requested evidence. ').repeat(3)) + '</p>');
  return {name: 'Research article ' + size, search: 'automation research ' + size,
    html: paragraphs.join('') + sources.map(source => '<p>' + escape(source.fact) + '</p><p>Source: ' + escape(source.url) + '</p>').join('') + '<p>Unicode retrieval 🐱 end.</p>'};
});
let fixtureState = {query: '', searched: 0, clicked: 0, size: 0};
const fixture = http.createServer((request, response) => {
  if (request.url === '/state') {
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(fixtureState)); return;
  }
  if (request.url.startsWith('/event?')) {
    const args = new URL(request.url, 'http://127.0.0.1').searchParams;
    fixtureState.query = args.get('query'); fixtureState.size = Number(args.get('size'));
    fixtureState[args.get('kind') === 'searched' ? 'searched' : 'clicked']++;
    response.end('ok'); return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><html lang="en"><title>${title}</title><style>
    body{font:16px sans-serif;margin:0}header{position:sticky;top:0;background:white;padding:10px}main{padding:10px}
    </style><header><label>Research search <input aria-label="Research search"></label><button>Find research</button></header>
    <main><div id="results">Enter a research query.</div><article id="article"></article></main><script>
    const cases=${JSON.stringify(cases).replaceAll('<', '\\u003c')};
    const field=document.querySelector('input'), results=document.querySelector('#results'), article=document.querySelector('#article');
    document.querySelector('button').onclick=()=>{
      const found=cases.find(item=>item.search===field.value); article.innerHTML=''; results.textContent='Loading results';
      if(!found)return;
      fetch('/event?kind=searched&query='+encodeURIComponent(field.value)+'&size='+found.name.split(' ').at(-1));
      setTimeout(()=>{
        const link=document.createElement('a');link.href='#article';link.textContent=found.name;results.replaceChildren(link);
        link.onclick=()=>{article.innerHTML=found.html;fetch('/event?kind=clicked&query='+encodeURIComponent(field.value)+'&size='+found.name.split(' ').at(-1));};
      },150);
    };</script></html>`);
});
const report = {schema_version: 1, complete: false, measured_at: new Date().toISOString(), runs_per_mode_case: options.runs,
  modes: options.modes, source_revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  environment: {node: process.version, platform: process.platform, cpu: os.cpus()[0].model, browser_profile: 'existing Edge profile', companion: 'enabled', transport: 'stdio'},
  sources, samples: [], timing: [],
  limits: ['Controlled search corpus quotes researched public documentation, rendered in real Edge; controlled timings exclude internet search-engine latency.',
    'Search and result clicks use actual repository MCP/native UIA. Server state independently checks the exact query and result click.',
    'Retrieval ends only after all three source facts are returned. Page scanning stops at the same requested facts, not at arbitrary complete-page coverage.',
    'MCP/companion startup and tab preparation are excluded. Retrieval and whole search/click/retrieve workflow are measured separately.',
    'Mode order rotates and reverses across paired rounds. One warm browser and native worker are reused; no failed input is replayed.',
    'Range excerpts concern accessible provider text; they are not complete page coverage or a full-document version. No AI inference is measured.']};
let session, window, current, ownedTab = false, liveStarted = false, baseUrl, expectedClicks = 0, expectedSearches = 0;
const parse = result => {
  assert(!result.isError, result.content.find(item => item.type === 'text')?.text);
  assert(!result.content.some(item => item.type === 'image'));
  return JSON.parse(result.content.find(item => item.type === 'text').text);
};
async function api(tool, args) {
  const begin = performance.now(), call = {tool, args, phase: current?.phase};
  if (current) current.calls.push(call);
  try {
    const result = await session.client.callTool({name: tool, arguments: args}, undefined, {timeout: 60000});
    call.response_chars = result.content.filter(item => item.type === 'text').reduce((sum, item) => sum + item.text.length, 0);
    return parse(result);
  }
  catch (error) {call.error = error.message; throw error;}
  finally {call.elapsed_ms = performance.now() - begin;}
}
const windows = args => api('windows', {...args, max_depth: 30, max_chars: 16000});
const target = (ui, node) => ({snapshot: ui.snapshot, element_id: node.id});
async function ui(name, role) {return windows({action: 'get_ui', ...window, query: name, control_type: role});}
function one(result, exactName, action) {
  assert(result.complete && !result.truncated, 'Incomplete discovery; no target selected.');
  const nodes = result.nodes.filter(node => node.name === exactName && node.targetable && node.actions?.includes(action));
  assert.equal(nodes.length, 1, 'Expected one supported control ' + exactName + ': ' + JSON.stringify(result).slice(0, 1300));
  return nodes[0];
}
async function poll(read, accept, timeout = 15000) {
  const deadline = performance.now() + timeout;
  let value;
  do {value = await read(); if (accept(value)) return value; await delay(100);} while (performance.now() < deadline);
  throw new Error('Readiness check timed out: ' + JSON.stringify(value).slice(0, 1000));
}
async function navigate(url, documentName) {
  const address = await ui('Address and search bar', 'Edit'), field = one(address, 'Address and search bar', 'set_value');
  await windows({steps: [{action: 'focus', ...target(address, field)}, {action: 'set_value', ...target(address, field), text: url},
    {action: 'get_ui', ...window, query: 'Address and search bar', control_type: 'Edit', expect_value: url}]});
  await api('computer', {action: 'key', text: 'Return', ...window});
  if (documentName) {
    const documents = await poll(() => ui(documentName, 'Document'), result => result.complete && result.nodes.some(node => node.name === documentName && node.targetable));
    const doc = one(documents, documentName, 'focus');
    await windows({action: 'focus', ...target(documents, doc)});
  }
}
async function retrieve(mode, documentName, facts = sources) {
  const base = {...window, document_name: documentName, timeout_ms: 15000, max_chars: 16000};
  if (mode === 'page_scan') {
    let offset = 0, version, text = '';
    for (let pages = 0; pages < 100; pages++) {
      const page = await api('course', {action: 'read_lesson', ...base, offset, version, page_chars: 12000});
      assert(!page.source_truncated);
      version ||= page.version; text += page.text;
      if (facts.every(source => text.includes(source.fact))) return {text, pages: pages + 1, total_characters: page.total_characters, version};
      assert(page.has_more && page.next_offset > offset, 'Expected information was not found in the complete accessible text.');
      offset = page.next_offset;
    }
    throw new Error('Page scan exceeded the page budget.');
  }
  if (mode === 'range_single') {
    const excerpts = [];
    for (const source of facts) {
      const result = await api('research', {action: 'find_text', ...base, query: source.query, context_chars: 300});
      assert(result.found && result.text.includes(source.fact), 'Range retrieval did not return the expected source fact.');
      excerpts.push(result);
    }
    return {excerpts};
  }
  const result = await api('research', {action: 'find_many', ...base, queries: facts.map(source => source.query), context_chars: 300});
  assert.equal(result.results.length, facts.length);
  for (const [i, source] of facts.entries()) assert(result.results[i].found && result.results[i].text.includes(source.fact));
  return result;
}
async function checkpoint() {await mkdir(dirname(output), {recursive: true}); await writeFile(output, JSON.stringify(report, null, 2) + '\n');}
async function verifyRetrieval() {
  report.correctness = [];
  const base = {...window, document_name: title, timeout_ms: 15000, max_chars: 16000};
  const check = async (name, args, accept, expectedError = false) => {
    const result = await session.client.callTool({name: 'research', arguments: {...base, ...args}});
    assert.equal(Boolean(result.isError), expectedError, result.content[0].text);
    const data = JSON.parse(result.content[0].text);
    assert(result.content[0].text.length <= (args.max_chars || 16000));
    accept(data);
    report.correctness.push({name, passed: true, result: data});
  };
  await check('negative accessible match', {action: 'find_text', query: 'absent-' + nonce}, data => assert(!data.found && data.text === ''));
  await check('case insensitive native range', {action: 'find_text', query: sources[0].query.toUpperCase()}, data => assert(data.found && data.text.includes(sources[0].fact)));
  await check('case sensitive native range', {action: 'find_text', query: sources[0].query.toUpperCase(), ignore_case: false}, data => assert(!data.found));
  await check('zero context and duplicate query order', {action: 'find_many', queries: [sources[2].query, sources[0].query, sources[2].query], context_chars: 0}, data => {
    assert.deepEqual(data.results.map(row => row.text), [sources[2].query, sources[0].query, sources[2].query]);
    assert(data.results.every(row => row.found && !row.source_truncated && ['native_range', 'bounded_full_text_fallback'].includes(row.method)));
  });
  await check('Unicode excerpt', {action: 'find_text', query: 'retrieval 🐱'}, data => assert(data.found && data.text.includes('retrieval 🐱')));
  await check('bounded escaped evidence', {action: 'find_many', queries: sources.slice(0, 2).map(source => source.query), context_chars: 1000, max_chars: 1000}, data => {
    assert.equal(data.results.length, 2); assert(data.response_truncated);
    for (const row of data.results) {
      assert(row.excerpt_truncated && !/[\uD800-\uDBFF]$/.test(row.text));
      assert.equal(row.excerpt_sha256, createHash('sha256').update(row.text, 'utf16le').digest('hex'));
    }
  });
  await check('metadata budget rejection', {action: 'find_many', queries: Array.from({length: 8}, () => sources[0].query), max_chars: 1000}, data => {
    assert.equal(data.error_details.code, 'OUTPUT_BUDGET'); assert.equal(data.requested_queries, 8); assert.equal(data.results_returned, 0);
  }, true);
  await check('wrong document rejected', {action: 'find_text', document_name: 'absent-' + nonce, query: sources[0].query}, data => assert.equal(data.error_details.code, 'AMBIGUOUS_TARGET'), true);
  const native = new WindowsAutomation();
  try {
    await native.withControlLease(async () => {
      await assert.rejects(native.request({action: 'find_text_ranges', snapshot: '0'.repeat(32), element_id: 1, queries: ['x'], context_chars: 0, ignore_case: true}), error => error.details?.code === 'STALE_REF');
      report.correctness.push({name: 'native stale reference rejected', passed: true});
      const listed = await native.request({action: 'get_windows', query: 'msedge', max_chars: 16000});
      const selected = listed.windows.find(item => item.id === window.window_id);
      assert(listed.complete && selected);
      const fields = await native.request({action: 'get_ui', window_id: selected.id, window_ref: selected.window_ref,
        query: 'Research search', control_type: 'Edit', max_depth: 30, max_chars: 16000});
      const field = one(fields, 'Research search', 'read_text');
      await assert.rejects(native.request({action: 'find_text_range', ...target(fields, field), text: 'x', context_chars: 0, ignore_case: true}), error => error.details?.code === 'ACTION_NOT_SUPPORTED');
      report.correctness.push({name: 'native non-Document rejected', passed: true});
    });
  } finally {native.close();}
  console.log('Native retrieval correctness checks passed.');
}
try {
  await new Promise((ready, reject) => {fixture.once('error', reject); fixture.listen(0, '127.0.0.1', ready);});
  baseUrl = 'http://127.0.0.1:' + fixture.address().port;
  const startup = performance.now();
  session = await connect({stderr: 'pipe', env: {...process.env, POKEMON_UI: 'on', POKEMON_TIMING: '1'}});
  let buffer = '';
  session.transport.stderr.on('data', chunk => {buffer += chunk; while (buffer.includes('\n')) {
    const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (line.startsWith('[pokemon-timing] ')) report.timing.push(JSON.parse(line.slice(17)));
  }});
  await session.call('pokemon', {action: 'task', message: 'Benchmarking web information retrieval in your Edge profile'});
  report.startup_ms = performance.now() - startup;
  const listed = await windows({action: 'get_windows', query: 'msedge'});
  assert(listed.complete);
  const candidates = listed.windows.filter(win => !options.windowId || win.id === options.windowId);
  assert.equal(candidates.length, 1, 'Choose an existing Edge window with --window-id; no new signed-out profile is created.');
  window = {window_id: candidates[0].id, window_ref: candidates[0].window_ref};
  const tabs = await ui('New tab', 'Button');
  const newTab = tabs.nodes.filter(node => node.name.toLowerCase() === 'new tab' && node.targetable && node.actions?.includes('invoke'));
  assert(tabs.complete && newTab.length === 1);
  await windows({action: 'invoke', ...target(tabs, newTab[0])}); ownedTab = true;
  await navigate(baseUrl + '/?nonce=' + nonce, title);
  const built = ['tools/course.js', 'tools/research.js', 'windows/research.js', 'windows/actions.js', 'learning/instructions.js', 'windows/uia-worker.dll', 'pokemon/runtime.js'];
  report.artifact_sha256 = Object.fromEntries(await Promise.all(built.map(async file => [file, createHash('sha256').update(await readFile(resolve(root, 'backend/dist', file))).digest('hex')])));
  report.harness_sha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
  report.corpus_sha256 = createHash('sha256').update(JSON.stringify(cases)).digest('hex');
  await checkpoint();
  for (let round = 0; round < options.runs; round++) {
    const order = options.modes.map((_, i) => options.modes[(i + round) % options.modes.length]);
    if (round % 2) order.reverse();
    for (const item of cases) for (const mode of order) {
      current = {round, mode, case: item.name, verified: false, calls: [], phase: 'search'};
      report.samples.push(current);
      const start = performance.now();
      try {
        const field = await ui('Research search', 'Edit'), search = one(field, 'Research search', 'set_value');
        await windows({steps: [{action: 'set_value', ...target(field, search), text: item.search},
          {action: 'get_ui', ...window, query: 'Research search', control_type: 'Edit', expect_value: item.search},
          {action: 'get_ui', ...window, query: 'Find research', control_type: 'Button'}, {action: 'invoke', target_step: 2}]});
        const link = await poll(() => ui(item.name, 'Hyperlink'), result => result.complete && result.nodes.some(node => node.name === item.name && node.targetable));
        await windows({action: 'invoke', ...target(link, one(link, item.name, 'invoke'))});
        current.phase = 'retrieve';
        const before = performance.now(), callStart = current.calls.length;
        current.result = await retrieve(mode, title);
        current.retrieval_ms = performance.now() - before;
        current.workflow_ms = performance.now() - start;
        current.retrieval_mcp_calls = current.calls.length - callStart;
        current.returned_chars = current.calls.slice(callStart).reduce((sum, call) => sum + (call.response_chars || 0), 0);
        expectedSearches++; expectedClicks++;
        const state = await poll(async () => (await fetch(baseUrl + '/state')).json(), state => state.searched === expectedSearches && state.clicked === expectedClicks);
        assert.equal(state.query, item.search); assert.equal(state.size, Number(item.name.split(' ').at(-1)));
        current.verified = true;
        console.log(mode + ' ' + item.name + ': retrieval ' + current.retrieval_ms.toFixed(1) + ' ms; workflow ' + current.workflow_ms.toFixed(1) + ' ms');
      } catch (error) {current.error = error.message; throw error;}
      finally {delete current.phase; current = undefined; await checkpoint();}
    }
  }
  if (options.verify) await verifyRetrieval();
  if (options.live) {
    liveStarted = true; current = {mode: 'live_bing', calls: [], phase: 'search', verified: false}; report.live = current;
    const begin = performance.now();
    const searchUrl = 'https://www.bing.com/search?q=' + encodeURIComponent('site:learn.microsoft.com "Caching in UI Automation Clients"');
    current.search_url = searchUrl;
    await navigate(searchUrl);
    const results = await poll(() => ui('Caching in UI Automation', 'Hyperlink'), result => result.complete && result.nodes.some(node => node.targetable && node.actions?.includes('invoke')), 30000);
    const links = results.nodes.filter(node => node.targetable && node.actions?.includes('invoke') && node.name.toLowerCase().includes('caching in ui automation'));
    assert.equal(links.length, 1, 'Live search result was ambiguous.');
    await windows({action: 'invoke', ...target(results, links[0])});
    const document = await poll(() => ui('Caching in UI Automation Clients', 'Document'), result => result.complete && result.nodes.length === 1, 30000);
    const docName = document.nodes[0].name;
    const address = await ui('Address and search bar', 'Edit');
    const url = address.nodes[0].value;
    assert(url.includes('learn.microsoft.com/en-us/dotnet/framework/ui-automation/caching-in-ui-automation-clients'));
    current.phase = 'retrieve';
    const before = performance.now();
    current.result = await retrieve(options.modes.includes('range_many') ? 'range_many' : options.modes.at(-1), docName, [sources[0]]);
    current.retrieval_ms = performance.now() - before; current.workflow_ms = performance.now() - begin;
    current.source_url = url; current.verified = true; delete current.phase; current = undefined;
  }
  report.complete = true;
  await session.call('pokemon', {action: 'done', message: 'Information retrieval benchmark verified source evidence'});
} catch (error) {report.complete = false; report.error = error.message; if (current) current.error = error.message; process.exitCode = 1; console.error(error.message);}
finally {
  if (session && ownedTab && !liveStarted) {
    try {
      const documents = await ui(title, 'Document');
      assert(documents.complete && documents.nodes.some(node => node.name === title));
      const address = await ui('Address and search bar', 'Edit');
      assert(address.nodes[0].value.startsWith(baseUrl + '/'));
      await windows({action: 'focus', ...target(address, one(address, 'Address and search bar', 'focus'))});
      await api('computer', {action: 'key', text: 'ctrl+w', ...window});
    } catch (error) {report.cleanup_note = 'Benchmark tab left open: ' + error.message;}
  }
  if (session) await session.client.close();
  await new Promise(done => {fixture.close(done); fixture.closeAllConnections();});
  report.summary = {};
  for (const mode of options.modes) for (const item of cases) {
    const rows = report.samples.filter(sample => sample.mode === mode && sample.case === item.name && sample.verified);
    report.summary[mode + ':' + item.name] = {verified: rows.length, retrieval: distribution(rows.map(row => row.retrieval_ms)),
      workflow: distribution(rows.map(row => row.workflow_ms)), calls: rows.map(row => row.retrieval_mcp_calls)};
  }
  await checkpoint();
  const table = Object.entries(report.summary).map(([name, row]) => '| ' + name + ' | ' + row.verified + ' | ' + (row.retrieval?.median_ms.toFixed(1) || '—') + ' | ' + (row.workflow?.median_ms.toFixed(1) || '—') + ' |');
  await writeFile(output.replace(/\.json$/, '.md'), '# Information retrieval benchmark\n\n'
    + (report.complete ? 'All requested samples passed.' : 'Incomplete: ' + report.error) + '\n\n'
    + '| Mode / corpus | Verified | Retrieval median ms | Workflow median ms |\n| --- | ---: | ---: | ---: |\n' + table.join('\n')
    + '\n\n' + report.limits.join('\n\n') + '\n\nCorrectness checks passed: ' + (report.correctness?.filter(check => check.passed).length || 0)
    + '.\n\nLive Bing: ' + (report.live?.verified ? 'verified; workflow ' + report.live.workflow_ms.toFixed(1) + ' ms, retrieval ' + report.live.retrieval_ms.toFixed(1) + ' ms, source ' + report.live.source_url : 'not requested or not verified') + '.\n');
  console.log('Saved ' + options.output);
}
