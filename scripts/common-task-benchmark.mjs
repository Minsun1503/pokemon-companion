import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {cpus, tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {execFileSync, spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {connect} from './client.mjs';
import {BenchmarkBlocked, commonOptions, decode, failureStatus, observedLoopbackUrl, oneControl, pairedOrder, renderCommonReport, summarize, textPdf} from './common-task-benchmark-lib.mjs';
import {createCommonFixture, factsFor, titleFor} from './common-task-fixture.mjs';

assert.equal(process.platform, 'win32', 'Requires an unlocked Windows desktop.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = commonOptions(process.argv.slice(2));
const output = resolve(root, options.output), nonce = randomUUID().slice(0, 8);
const report = {schema_version: 1, complete: false, measured_at: new Date().toISOString(), options,
  source_revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  source_dirty: Boolean(execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim()),
  environment: {node: process.version, cpu: cpus()[0].model, platform: process.platform, transport: 'stdio', companion: 'on', profile: 'existing Edge profile'},
  samples: [], timing: [], notes: [],
  strategies: {window_discovery: 'Same process discovery, reference measurement.', control_discovery: 'Whole-window lookup vs fresh observed Document subtree; root setup excluded.',
    enter_text_verify: 'Three atomic calls vs one three-step Windows batch.', search_and_open: 'Atomic field/button calls and client polling vs batch and native wait_for.',
    button_result: 'Atomic discovery/invoke vs one batch, then independently verified outcome.', document_passages: 'Versioned full-text pagination vs one find_many call.',
    url_open: 'Atomic address focus/value/check vs batched address actions; both verify the loaded Document.', pdf_open_read: 'Actual Edge PDF load and accessible text retrieval; no fake HTML PDF.',
    excel_read: 'Ten single-cell reads vs one rectangular range read.', excel_write_calculate_save: 'Ten single-cell writes vs one bulk write; both calculate, save and independently reopen.'},
  limits: ['This is an execution benchmark of shared operations in real Edge and desktop Excel with owned synthetic data, not a test of Zalo, Teams, Outlook, SharePoint, Drive, Dicreto or GS1 integrations.',
    'Baseline and optimized are alternative execution strategies in the same build, not a historical Git-revision comparison. Window discovery uses the same strategy as a noise reference.',
    'Timers start at the first MCP request and end after outcome verification. Model inference, user-request intake, startup/tab preparation and per-case fixture setup are excluded.',
    'One warmup per case/strategy is excluded. Order reverses across paired rounds. App/OS/network caches are not reset; PDF cases use new URLs.',
    'Opening an actual PDF is insufficient: its seeded text must be retrieved through MCP. Unsupported accessibility is reported as blocked.',
    'Full workflow elapsed includes independent server or Excel verification. Action and verification durations are also reported separately. Native spans overlap and are not added to totals.',
    'A failed scenario is not replayed. Remaining scheduled rows are recorded as blocked. Failures/timeouts are preserved alongside successful distributions.',
    'Small-sample p95 is the slowest observed sample. These timings do not predict arbitrary cloud loading or AI-client latency.']};
let baseUrl, session, window, current, currentCase, ownedTab = false, excel, rowNumber = 2;
const fixture = createCommonFixture(nonce);
async function api(tool, args) {
  const call = {tool, action: args.action || 'batch', phase: current?.phase, started_ms: performance.now()};
  if (current) {current.calls.push(call); if (current.start == null) current.start = call.started_ms;}
  try {
    const result = decode(await session.client.callTool({name: tool, arguments: args}, undefined, {timeout: 60000}));
    call.response_chars = result.response_chars; return result.data;
  } catch (error) {call.error = error.message; call.response_chars ||= 0; throw error;}
  finally {call.elapsed_ms = performance.now() - call.started_ms;}
}
async function windows(args) {const result = await api('windows', {max_chars: 16000, max_depth: 30, ...args}); return args.steps ? result.result : result;}
const ui = (name, role, extra = {}) => windows({action: 'get_ui', ...window, query: name, control_type: role, ...extra});
async function poll(read, accept, timeout = options.timeout) {
  const end = performance.now() + timeout;
  do {const value = await read(); if (accept(value)) return value; await delay(75);} while (performance.now() < end);
  const error = new Error('Expected state did not become ready within ' + timeout + ' ms.'); error.code = 'TIMEOUT'; throw error;
}
async function waitControl(name, role, mode) {
  if (mode === 'optimized') return windows({action: 'wait_for', ...window, query: name, control_type: role, timeout_ms: Math.min(15000, options.timeout)});
  return poll(() => ui(name, role), result => result.complete && result.nodes.some(node => node.name === name && node.targetable));
}
async function invoke(name, mode = 'optimized', role = 'Button') {
  if (mode === 'optimized') return windows({steps: [{action: 'get_ui', ...window, query: name, control_type: role}, {action: 'invoke', target_step: 0}]});
  const observed = await ui(name, role); return windows({action: 'invoke', ...oneControl(observed, name, 'invoke')});
}
async function navigate(url, name, mode = 'optimized') {
  const address = 'Address and search bar';
  if (mode === 'optimized') {
    await windows({steps: [{action: 'get_ui', ...window, query: address, control_type: 'Edit'}, {action: 'focus', target_step: 0},
      {action: 'set_value', target_step: 0, text: url}, {action: 'get_ui', ...window, query: address, control_type: 'Edit', expect_value: url}]});
  } else {
    const observed = await ui(address, 'Edit'), target = oneControl(observed, address, 'set_value');
    await windows({action: 'focus', ...target}); await windows({action: 'set_value', ...target, text: url});
    const value = await ui(address, 'Edit'); assert.equal(value.nodes[0].value, url); assert(!value.nodes[0].value_clipped);
  }
  await api('computer', {action: 'key', text: 'Return', ...window});
  if (name) {
    const docs = await waitControl(name, 'Document', mode);
    await windows({action: 'focus', ...oneControl(docs, name, 'focus')});
    if (current) current.first_useful_ms ??= performance.now() - current.start;
  }
}
async function searchAndOpen(token, mode) {
  const text = 'Record ' + token;
  if (mode === 'optimized') {
    await windows({steps: [{action: 'get_ui', ...window, query: 'Record search', control_type: 'Edit'}, {action: 'set_value', target_step: 0, text},
      {action: 'get_ui', ...window, query: 'Record search', control_type: 'Edit', expect_value: text},
      {action: 'get_ui', ...window, query: 'Find record', control_type: 'Button'}, {action: 'invoke', target_step: 3}]});
  } else {
    const observed = await ui('Record search', 'Edit');
    await windows({action: 'set_value', ...oneControl(observed, 'Record search', 'set_value'), text});
    const value = await ui('Record search', 'Edit'); assert.equal(value.nodes[0].value, text); assert(!value.nodes[0].value_clipped);
    await invoke('Find record', mode);
  }
  const result = await waitControl(text, 'Hyperlink', mode);
  await windows({action: 'invoke', ...oneControl(result, text, 'invoke')});
}
async function readFacts(token, mode) {
  const facts = factsFor(token), base = {...window, document_name: titleFor(token), timeout_ms: 15000, max_chars: 16000};
  if (mode === 'optimized') {
    const result = await api('research', {action: 'find_many', ...base, queries: ['Shipment quantity:', 'Invoice total:', 'Record key:'], context_chars: 150});
    assert.equal(result.results.length, facts.length);
    facts.forEach((fact, index) => assert(result.results[index].found && result.results[index].text.includes(fact)));
    return {facts, methods: result.results.map(row => row.method)};
  }
  let offset = 0, version, text = '';
  for (let page = 0; page < 30; page++) {
    const result = await api('course', {action: 'read_lesson', ...base, offset, version, page_chars: 12000});
    assert(!result.source_truncated); version ||= result.version; text += result.text;
    if (facts.every(fact => text.includes(fact))) return {facts, pages: page + 1};
    assert(result.has_more && result.next_offset > offset, 'Expected facts absent from accessible document.'); offset = result.next_offset;
  }
  throw new Error('Document page budget exceeded.');
}
async function state(accept) {
  return poll(async () => {const response = await fetch(baseUrl + '/state', {signal: AbortSignal.timeout(3000)}); return response.json();}, accept);
}
async function startExcel() {
  const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-common-excel-'));
  const compiler = resolve(scratch, 'compile.ps1'), executable = resolve(scratch, 'Fixture.exe');
  await writeFile(compiler, 'param($source,$output)\n$ErrorActionPreference="Stop"\nAdd-Type -Path $source -ReferencedAssemblies System.Web.Extensions -OutputAssembly $output -OutputType ConsoleApplication\n');
  try {execFileSync(resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', compiler,
    resolve(root, 'scripts/common-task-excel-fixture.cs'), executable], {windowsHide: true, stdio: 'pipe'});}
  catch (error) {throw new Error('Excel fixture compile failed: ' + error.message);}
  const started = performance.now(), child = spawn(executable, [scratch, nonce], {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  const closed = new Promise(done => child.once('exit', done));
  const lines = createInterface({input: child.stdout}), iterator = lines[Symbol.asyncIterator]();
  let diagnostic = ''; child.stderr.on('data', data => {diagnostic = (diagnostic + data).slice(-2000);});
  async function receive() {
    let timer;
    try {
      const line = await Promise.race([iterator.next(), new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('Owned Excel fixture timed out.')), 20000);})]);
      assert(!line.done, diagnostic || 'Owned Excel fixture exited.');
      const value = JSON.parse(line.value.replace(/^\uFEFF/, '')); if (value.kind === 'error') throw new BenchmarkBlocked(value.error); return value;
    } finally {clearTimeout(timer);}
  }
  const instance = {child, scratch, async command(command) {child.stdin.write(command + '\n'); return receive();},
    async close() {
      if (child.exitCode === null && child.signalCode === null) child.stdin.end('close\n');
      let timer; try {await Promise.race([closed, new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('Owned Excel fixture did not close; preserved test files.')), 10000);})]);}
      finally {clearTimeout(timer); lines.close();}
      const checked = await realpath(scratch), temp = await realpath(tmpdir());
      assert.equal(dirname(checked).toLowerCase(), temp.toLowerCase()); assert(checked.split(/[\\/]/).at(-1).startsWith('pokemon-common-excel-'));
      await rm(checked, {recursive: true, force: true});
    }};
  try {instance.info = await receive(); assert.equal(instance.info.kind, 'ready'); report.excel_fixture_startup_ms = performance.now() - started; return instance;}
  catch (error) {await instance.close(); throw error;}
}
async function excelBase() {
  if (!excel) throw new BenchmarkBlocked(report.excel_unavailable || 'Desktop Excel fixture unavailable.');
  const found = await windows({action: 'get_windows', query: excel.info.name});
  assert(found.complete && found.windows.length === 1);
  const selected = found.windows[0];
  const observed = await api('excel', {action: 'inspect_workbook', window_id: selected.id, window_ref: selected.window_ref, timeout_ms: 15000});
  assert.equal(observed.full_name, excel.info.path);
  return {window_id: selected.id, window_ref: selected.window_ref, workbook_name: observed.workbook_name, sheet: 'Data', timeout_ms: 15000, max_chars: 16000};
}
async function prepare(name) {
  const token = nonce + '-' + randomUUID().slice(0, 6);
  if (name.startsWith('excel_')) return {token, excel: await excelBase(), row: ++rowNumber};
  const found = await windows({action: 'get_windows', query: 'msedge'});
  const selected = found.windows.find(win => win.id === window.window_id);
  assert(found.complete && selected, 'The selected Edge window is no longer available.');
  window = {window_id: selected.id, window_ref: selected.window_ref};
  await navigate(baseUrl + '/work?token=' + token, titleFor(token));
  if (name === 'document_passages') await invoke('Load document');
  if (name === 'button_result') await searchAndOpen(token, 'optimized');
  const docs = await ui(titleFor(token), 'Document');
  return {token, scope: {root_snapshot: docs.snapshot, root_element_id: oneControl(docs, titleFor(token), 'read_text').element_id}};
}
async function execute(name, mode, setup) {
  const token = setup.token;
  if (name === 'window_discovery') {
    const result = await windows({action: 'get_windows', query: 'msedge'}); assert(result.complete && result.windows.some(win => win.id === window.window_id));
    return async () => ({matched_window: true});
  }
  if (name === 'control_discovery') {
    const result = await ui('Record search', 'Edit', mode === 'optimized' ? setup.scope : {}); oneControl(result, 'Record search', 'set_value');
    return async () => ({matched_control: true, scanned: result.scanned});
  }
  if (name === 'enter_text_verify') {
    const text = '0123456789'.repeat(5);
    if (mode === 'optimized') {
      await windows({steps: [{action: 'get_ui', ...window, query: 'Record search', control_type: 'Edit'}, {action: 'set_value', target_step: 0, text},
        {action: 'get_ui', ...window, query: 'Record search', control_type: 'Edit', expect_value: text}]});
    } else {
      const result = await ui('Record search', 'Edit'); await windows({action: 'set_value', ...oneControl(result, 'Record search', 'set_value'), text});
      const value = await ui('Record search', 'Edit'); assert.equal(value.nodes[0].value, text); assert(!value.nodes[0].value_clipped);
    }
    return async () => {const observed = await ui('Record search', 'Edit'); assert.equal(observed.nodes[0].value, text); return {exact_value: true};};
  }
  if (name === 'search_and_open') {
    await searchAndOpen(token, mode); const evidence = await readFacts(token, mode);
    return async () => {const observed = await state(value => value.token === token && value.search === 1 && value.click === 1); assert.equal(observed.query, 'Record ' + token); return evidence;};
  }
  if (name === 'button_result') {
    await invoke('Open details', mode);
    const text = await api('research', {action: 'find_text', ...window, document_name: titleFor(token), query: 'Record status:', context_chars: 100, max_chars: 4000});
    assert(text.found && text.text.includes('Record status: Active.') && text.text.includes('Record key: ' + token));
    return async () => {await state(value => value.token === token && value.details === 1 && value.click === 1); return {record_and_button_result: true};};
  }
  if (name === 'document_passages') {
    const evidence = await readFacts(token, mode); return async () => {await state(value => value.token === token && value.load === 1); return evidence;};
  }
  if (name === 'url_open') {
    const next = token + '-nav'; await navigate(baseUrl + '/work?token=' + next, titleFor(next), mode);
    const text = await api('research', {action: 'find_text', ...window, document_name: titleFor(next), query: 'Ready ' + next, context_chars: 0, max_chars: 4000});
    assert(text.found && text.text.includes('Ready ' + next));
    return async () => {await state(value => value.token === next); return {loaded_requested_document: true};};
  }
  if (name === 'pdf_open_read') {
    const url = baseUrl + '/invoice-' + token + '.pdf'; await navigate(url, undefined, mode);
    let docs;
    try {docs = await poll(() => ui('', 'Document'), value => value.complete && value.nodes.some(node => node.targetable && (node.name.includes(token) || node.value?.includes('/invoice-' + token))), Math.min(options.timeout, 8000));}
    catch {throw new BenchmarkBlocked('Edge PDF viewer exposed no identifiable accessible Document.');}
    const selected = docs.nodes.filter(node => node.targetable && (node.name.includes(token) || node.value?.includes('/invoice-' + token)));
    let text = '', textSource = 'document_read_text';
    const unsupported = [];
    for (const doc of selected) {
      if (!doc.actions?.includes('read_text')) continue;
      try {const value = await windows({action: 'read_text', snapshot: docs.snapshot, element_id: doc.id}); text += value.text || '';}
      catch (error) {
        if (error.details?.code !== 'AMBIGUOUS_TARGET') throw error;
        unsupported.push(error.message);
      }
    }
    if (!factsFor(token).every(fact => text.includes(fact))) {
      try {
        const nodes = await poll(() => ui('', 'Text', {max_elements: 250}), value => value.complete && !value.truncated
          && factsFor(token).every(fact => (text + value.nodes.map(node => node.name).join('\n')).includes(fact)), Math.min(options.timeout, 8000));
        text += nodes.nodes.map(node => node.name).join('\n'); textSource = 'accessible_text_nodes';
      } catch (error) {if (error.code !== 'TIMEOUT') throw error;}
    }
    if (!factsFor(token).every(fact => text.includes(fact))) throw new BenchmarkBlocked('Actual Edge PDF loaded, but its text was not readable through the current native API. ' + unsupported.join(' '));
    return async () => {const address = await ui('Address and search bar', 'Edit'); assert.equal(observedLoopbackUrl(address.nodes[0].value), url);
      return {actual_pdf: true, text_source: textSource, identity_fallback: unsupported.length > 0, retrieved_facts: factsFor(token), pdf_sha256: createHash('sha256').update(textPdf('Common PDF ' + token, ['Common invoice ' + token, ...factsFor(token)])).digest('hex')};};
  }
  if (name === 'excel_read') {
    const values = [];
    if (mode === 'optimized') {const read = await api('excel', {action: 'read_range', ...setup.excel, range: 'A1:J1'}); values.push(...read.cells.map(cell => cell.value));}
    else for (let column = 0; column < 10; column++) {const read = await api('excel', {action: 'read_range', ...setup.excel, range: String.fromCharCode(65 + column) + '1'}); values.push(read.cells[0].value);}
    assert.deepEqual(values, Array.from({length: 10}, (_, index) => index + 1));
    return async () => {const observed = await excel.command('inspect:1'); assert.deepEqual(observed.values, values); assert(observed.other_untouched); return {ten_correct_cells: true};};
  }
  if (name === 'excel_write_calculate_save') {
    const row = setup.row, values = Array.from({length: 10}, (_, index) => index + 1);
    if (mode === 'optimized') {const result = await api('excel', {action: 'write_range', ...setup.excel, range: 'A' + row + ':J' + row, data: [values]}); assert(result.verified);}
    else for (let column = 0; column < 10; column++) {const result = await api('excel', {action: 'write_range', ...setup.excel, range: String.fromCharCode(65 + column) + row, data: [[values[column]]]}); assert(result.verified);}
    const formula = '=SUM(A' + row + ':J' + row + ')';
    const calculated = await api('excel', {action: 'write_range', ...setup.excel, range: 'K' + row, data: [[formula]], mode: 'formulas'}); assert(calculated.verified);
    const saved = await api('excel', {action: 'save_workbook', window_id: setup.excel.window_id, window_ref: setup.excel.window_ref,
      workbook_name: setup.excel.workbook_name, expected_path: excel.info.path, timeout_ms: 15000}); assert(saved.saved);
    return async () => {const observed = await excel.command('persist:' + row); assert.deepEqual(observed.values, values); assert.equal(observed.calculated, 55);
      assert.equal(observed.formula, formula); assert.equal(observed.path, excel.info.path); assert(observed.other_untouched); return {saved_and_reopened: true, calculated: observed.calculated};};
  }
  throw new Error('Unhandled scenario ' + name);
}
async function checkpoint() {
  report.summary = summarize(report.samples, options.cases, options.modes);
  await mkdir(dirname(output), {recursive: true}); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  await writeFile(output.replace(/\.json$/, '.md'), renderCommonReport(report));
}
const stopped = new Map();
async function attempt(name, mode, round, warmup = false) {
  const key = name;
  const sample = {case: name, mode, round, warmup, status: 'blocked', started: false, calls: []}; report.samples.push(sample);
  if (stopped.has(key)) {sample.reason = stopped.get(key); return checkpoint();}
  let setup;
  try {
    setup = await prepare(name); current = sample; sample.phase = 'action'; sample.started = true;
    const verify = await execute(name, mode, setup); assert(sample.start != null);
    sample.action_ms = performance.now() - sample.start; sample.phase = 'verification';
    const start = performance.now(); sample.evidence = await verify(); sample.verification_ms = performance.now() - start;
    sample.elapsed_ms = performance.now() - sample.start; sample.status = 'passed';
    console.log((warmup ? 'warmup ' : '') + name + ' ' + mode + ': ' + sample.elapsed_ms.toFixed(1) + ' ms, ' + sample.calls.length + ' calls, verified');
  } catch (error) {
    sample.status = failureStatus(error); sample.error = error.message; sample.stopped_phase = sample.phase || 'preparation';
    if (error.details) sample.error_details = error.details;
    if (sample.start != null) sample.elapsed_ms = performance.now() - sample.start;
    stopped.set(key, 'Earlier ' + sample.status + ': ' + error.message + '; no action replay.');
    console.error(name + ': ' + sample.status + ': ' + error.message);
    process.exitCode = sample.status === 'blocked' ? (process.exitCode || 2) : 1;
  } finally {delete sample.phase; current = undefined; await checkpoint();}
}
try {
  await new Promise((ready, reject) => {fixture.once('error', reject); fixture.listen(0, '127.0.0.1', ready);}); baseUrl = 'http://127.0.0.1:' + fixture.address().port;
  const connected = performance.now(); session = await connect({stderr: 'pipe', env: {...process.env, POKEMON_UI: 'on', POKEMON_TIMING: '1'}});
  let buffer = ''; session.transport.stderr.on('data', chunk => {buffer += chunk; while (buffer.includes('\n')) {
    const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (line.startsWith('[pokemon-timing] ')) report.timing.push(JSON.parse(line.slice(17)));
  }});
  await session.call('pokemon', {action: 'task', message: 'Benchmarking common desktop operations'}); report.mcp_startup_ms = performance.now() - connected;
  const found = await windows({action: 'get_windows', query: 'msedge'}); assert(found.complete);
  const candidates = found.windows.filter(win => !options.windowId || win.id === options.windowId);
  assert.equal(candidates.length, 1, 'Select an existing Edge window with --window-id.'); window = {window_id: candidates[0].id, window_ref: candidates[0].window_ref};
  const tab = await ui('New tab', 'Button'), button = tab.nodes.filter(node => node.name.toLowerCase() === 'new tab' && node.targetable && node.actions?.includes('invoke'));
  assert(tab.complete && button.length === 1); await windows({action: 'invoke', snapshot: tab.snapshot, element_id: button[0].id}); ownedTab = true;
  const built = ['windows/uia-worker.dll', 'windows/research.js', 'windows/excel.js', 'windows/batch.js', 'tools/excel.js', 'learning/instructions.js'];
  report.artifact_sha256 = Object.fromEntries(await Promise.all(built.map(async file => [file, createHash('sha256').update(await readFile(resolve(root, 'backend/dist', file))).digest('hex')])));
  report.harness_sha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
  report.fixture_sha256 = createHash('sha256').update(await readFile(resolve(root, 'scripts/common-task-fixture.mjs'))).digest('hex');
  report.harness_modules_sha256 = Object.fromEntries(await Promise.all(['common-task-benchmark.mjs', 'common-task-benchmark-lib.mjs', 'common-task-fixture.mjs', 'common-task-excel-fixture.cs'].map(async file =>
    [file, createHash('sha256').update(await readFile(resolve(root, 'scripts', file))).digest('hex')])));
  let excelPrepared = false;
  for (const name of options.cases) {
    currentCase = name;
    if (name.startsWith('excel_') && !excelPrepared) {
      excelPrepared = true;
      try {excel = await startExcel();} catch (error) {if (!(error instanceof BenchmarkBlocked)) throw error; report.excel_unavailable = error.message;}
    }
    for (const mode of options.modes) await attempt(name, mode, -1, true);
    for (let round = 0; round < options.runs; round++) for (const mode of pairedOrder(options.modes, round)) await attempt(name, mode, round);
  }
  report.complete = true;
  report.all_passed = stopped.size === 0;
  for (const [name, reason] of stopped) report.notes.push(name + ': ' + reason);
  if (!process.exitCode) await session.call('pokemon', {action: 'done', message: 'Common task benchmark recorded verified results'});
} catch (error) {report.error = error.message; report.stopped_case = currentCase; process.exitCode = 1; console.error(error.message);}
finally {
  current = undefined;
  if (session && ownedTab) {
    try {const address = await ui('Address and search bar', 'Edit'), location = observedLoopbackUrl(address.nodes[0].value); assert(location?.startsWith(baseUrl + '/') && location.includes(nonce));
      await windows({action: 'focus', ...oneControl(address, 'Address and search bar', 'focus')}); await api('computer', {action: 'key', text: 'ctrl+w', ...window});}
    catch (error) {report.notes.push('Benchmark tab left open: ' + error.message);}
  }
  if (session) await session.client.close();
  if (excel) {try {await excel.close();} catch (error) {report.notes.push(error.message); report.complete = false; process.exitCode = 1;}}
  await new Promise(done => {fixture.close(done); fixture.closeAllConnections();});
  await checkpoint(); console.log('Saved ' + options.output);
}
