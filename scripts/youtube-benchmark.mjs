import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {access, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import {dirname, relative, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {connect} from './client.mjs';
import {contentPlaying, distribution, playbackVerified} from './youtube-benchmark-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dateStamp = new Intl.DateTimeFormat('en-CA', {year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
const options = {runs: 3, query: 'Big Buck Bunny Blender', timeout: 90000,
  output: 'benchmarks/results/edge-youtube-' + dateStamp + '.json'};
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index], value = process.argv[index + 1];
  if (flag === '--runs') options.runs = Number(value);
  else if (flag === '--query') options.query = value;
  else if (flag === '--timeout') options.timeout = Number(value);
  else if (flag === '--output') options.output = value;
  else throw new Error('Usage: npm run benchmark:youtube -- --runs 3 --query "Big Buck Bunny Blender" --timeout 90000 --output results.json');
}
assert.equal(process.platform, 'win32', 'This benchmark requires an unlocked Windows desktop.');
assert(Number.isInteger(options.runs) && options.runs >= 1 && options.runs <= 20, '--runs must be 1..20.');
assert(typeof options.query === 'string' && options.query.trim() && options.query.length <= 150, '--query must be 1..150 characters.');
assert(Number.isInteger(options.timeout) && options.timeout >= 10000 && options.timeout <= 180000, '--timeout must be 10000..180000 ms per website wait.');
assert(options.output?.endsWith('.json'), '--output must end in .json.');
const output = resolve(root, options.output);
const scratch = await mkdtemp(resolve(os.tmpdir(), 'pokemon-youtube-'));
let session, browser, page, browserDebug, originalWindow;
let currentSample;
const stages = ['open_edge', 'open_youtube', 'search', 'click_video', 'verify_playback'];
const report = {schema_version: 1, complete: false, measured_at: new Date().toISOString(), query: options.query,
  requested_runs: options.runs, source_revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  environment: {platform: process.platform, node: process.version, cpu: os.cpus()[0].model, transport: 'stdio', companion: 'on'},
  method: {
    edge_launch: 'Harness spawns a fresh isolated Edge process/profile per run; application startup is timed. MCP/companion startup is separate.',
    actions: 'Repository MCP windows UI Automation for field entry and control invocation; foreground-guarded Enter submits the address bar.',
    verification: 'Read-only CDP observes only the dedicated benchmark tab: exact query, selected watch ID, player video ID, no active ad, and at least one second of unpaused media progress.',
    timing: 'Total starts before Edge spawn and ends at verified playback. Stage times include UIA discovery, actions, website/network/render waits and read-only verification. Cleanup and MCP startup are excluded.',
    repetitions: 'Fresh browser/profile per run; OS, Edge installation and network caches are not reset. No failed action or workflow is automatically retried.',
    limitations: 'Live YouTube, consent, sign-in challenges, ads, regional access, UI language and machine load affect results. No AI inference is measured. Small samples do not establish a stable p95.',
  }, samples: []};

class DebugConnection {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      const response = JSON.parse(event.data);
      const item = this.pending.get(response.id);
      if (!item) return;
      clearTimeout(item.timer); this.pending.delete(response.id);
      if (response.error) item.reject(new Error(response.error.message));
      else item.resolve(response.result);
    });
    const fail = () => {
      for (const item of this.pending.values()) {clearTimeout(item.timer); item.reject(new Error('Dedicated Edge debugging connection closed.'));}
      this.pending.clear();
    };
    socket.addEventListener('close', fail);
    socket.addEventListener('error', fail);
  }
  static async open(url) {
    const endpoint = new URL(url);
    assert.equal(endpoint.hostname, '127.0.0.1', 'Only the dedicated loopback browser may be inspected.');
    const socket = new WebSocket(url);
    await new Promise((ready, reject) => {
      const timer = setTimeout(() => {socket.close(); reject(new Error('Edge debugger did not connect.'));}, 10000);
      socket.addEventListener('open', () => {clearTimeout(timer); ready();}, {once: true});
      socket.addEventListener('error', () => {clearTimeout(timer); reject(new Error('Edge debugger connection failed.'));}, {once: true});
    });
    return new DebugConnection(socket);
  }
  async send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {this.pending.delete(id); reject(new Error(method + ' timed out.'));}, 10000);
      this.pending.set(id, {resolve: resolveRequest, reject, timer});
      this.socket.send(JSON.stringify({id, method, params}));
    });
  }
  close() {this.socket.close();}
}

const observation = `(() => {
  const player = document.querySelector('#movie_player');
  const video = document.querySelector('video');
  const search = document.querySelector('input[name="search_query"]');
  const candidates = [...document.querySelectorAll('ytd-video-renderer a#video-title[href*="/watch?"]')].map(link => {
    const rect = link.getBoundingClientRect();
    const url = new URL(link.href);
    return {title: link.getAttribute('title') || link.textContent.trim(), label: link.getAttribute('aria-label') || link.textContent.trim(),
      url: url.href, video_id: url.searchParams.get('v'), visible: rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0};
  }).filter(link => link.visible).slice(0, 5);
  let playerData = {};
  try {playerData = player?.getVideoData?.() || {};} catch {}
  return {url: location.href, hostname: location.hostname, pathname: location.pathname, title: document.title,
    search_query: search?.value || '', search_present: Boolean(search), result_query: new URL(location.href).searchParams.get('search_query'),
    video_id: new URL(location.href).searchParams.get('v'), player_video_id: playerData.video_id || '',
    ad_showing: Boolean(player?.classList.contains('ad-showing') || player?.classList.contains('ad-interrupting')),
    video: video ? {paused: video.paused, ended: video.ended, current_time: video.currentTime, ready_state: video.readyState,
      duration: Number.isFinite(video.duration) ? video.duration : null} : null, candidates,
    buttons: [...document.querySelectorAll('button')].map(button => button.getAttribute('aria-label') || button.textContent.trim()).filter(Boolean).slice(0, 35),
    visible_text: document.body?.innerText?.slice(0, 1500) || ''};
})()`;
async function observe() {
  const result = await page.send('Runtime.evaluate', {expression: observation, returnByValue: true});
  if (result.exceptionDetails) throw new Error('Read-only page observation failed.');
  assert(result.result?.value, 'Edge returned no page observation.');
  currentSample.last_observation = result.result.value;
  return result.result.value;
}
async function poll(read, accept, message, timeout = options.timeout) {
  const deadline = performance.now() + timeout;
  let last;
  do {
    last = await read();
    if (accept(last)) return last;
    if (last?.hostname === 'consent.youtube.com' || last?.hostname === 'accounts.google.com') throw new Error('YouTube requires consent or sign-in; the run stopped.');
    await delay(250);
  } while (performance.now() < deadline);
  throw new Error(message + ' Last observation: ' + JSON.stringify(last).slice(0, 1200));
}
async function api(name, args) {
  const started = performance.now();
  const record = {stage: currentSample?.active_stage, tool: name, args, elapsed_ms: 0};
  if (currentSample?.active_stage) currentSample.calls.push(record);
  try {
    const result = await session.client.callTool({name, arguments: args}, undefined, {timeout: 60000});
    record.elapsed_ms = performance.now() - started;
    assert(!result.content.some(item => item.type === 'image'), 'This benchmark should not require screenshots.');
    const content = result.content.find(item => item.type === 'text')?.text;
    record.response_chars = content?.length || 0;
    if (result.isError) {record.error = content; throw new Error(content);}
    return JSON.parse(content);
  } catch (error) {record.elapsed_ms = performance.now() - started; record.error ||= error.message; throw error;}
}
const windows = async args => {
  const result = await api('windows', {...args, max_depth: 30, max_chars: 16000});
  if (currentSample?.active_stage && args.action === 'get_ui') currentSample.last_ui = result;
  return result;
};
const target = (ui, node) => ({snapshot: ui.snapshot, element_id: node.id});
function unique(ui, name, action) {
  assert(ui.complete && !ui.truncated, 'UI discovery was incomplete; refuse to act.');
  const nodes = ui.nodes.filter(node => node.name === name && node.targetable && node.actions?.includes(action));
  assert.equal(nodes.length, 1, 'Expected one supported, capture-proven control: ' + name + '; ' + JSON.stringify(ui).slice(0, 1400));
  return nodes[0];
}
async function stage(name, run) {
  currentSample.active_stage = name;
  const started = performance.now();
  console.log('Run ' + currentSample.run + '/' + options.runs + ': ' + name);
  try {return await run();}
  catch (error) {currentSample.failed_stage = name; throw error;}
  finally {currentSample.stage_ms[name] = performance.now() - started; delete currentSample.active_stage;}
}
async function checkpoint() {
  await mkdir(dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
async function cleanupBrowser() {
  page?.close(); page = undefined;
  if (browserDebug) {
    await browserDebug.send('Browser.close').catch(() => {});
    browserDebug.close(); browserDebug = undefined;
  }
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    await Promise.race([new Promise(done => browser.once('exit', done)), delay(5000)]);
    if (browser.exitCode === null && browser.signalCode === null) {
      execFileSync('taskkill.exe', ['/PID', String(browser.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
    }
  }
  browser = undefined;
}

try {
  let edge;
  for (const candidate of [resolve(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    resolve(process.env.ProgramFiles || 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe')]) {
    try {await access(candidate); edge = candidate; break;} catch {}
  }
  assert(edge, 'Microsoft Edge is not installed in its standard location.');
  report.environment.edge = edge;
  const started = performance.now();
  session = await connect({stderr: 'pipe', env: {...process.env, POKEMON_UI: 'on', POKEMON_TIMING: '1',
    APPDATA: resolve(scratch, 'appdata'), POKEMON_LEARNING_DIR: resolve(scratch, 'learning')}});
  report.timings = [];
  let timingBuffer = '';
  session.transport.stderr.on('data', data => {
    timingBuffer += data;
    while (timingBuffer.includes('\n')) {
      const end = timingBuffer.indexOf('\n'), line = timingBuffer.slice(0, end); timingBuffer = timingBuffer.slice(end + 1);
      if (line.startsWith('[pokemon-timing] ')) report.timings.push(JSON.parse(line.slice(17)));
    }
  });
  await session.call('pokemon', {action: 'task', message: 'Benchmark: open Edge, search YouTube, and watch a video'});
  report.mcp_companion_start_ms = performance.now() - started;
  originalWindow = (await windows({action: 'get_windows'})).windows.find(win => win.active);
  const built = ['main.js', 'pokemon/runtime.js', 'tools/computer.js', 'tools/windows.js', 'windows/automation.js', 'windows/uia-worker.dll'];
  report.built_sha256 = Object.fromEntries(await Promise.all(built.map(async file => [file, createHash('sha256').update(await readFile(resolve(root, 'backend/dist', file))).digest('hex')])));
  report.benchmark_sha256 = Object.fromEntries(await Promise.all(['scripts/youtube-benchmark.mjs', 'scripts/youtube-benchmark-lib.mjs', 'scripts/client.mjs']
    .map(async file => [file, createHash('sha256').update(await readFile(resolve(root, file))).digest('hex')])));
  await checkpoint();
  for (let run = 1; run <= options.runs; run++) {
    currentSample = {run, verified: false, stage_ms: {}, calls: []};
    report.samples.push(currentSample);
    const begin = performance.now();
    try {
      let win;
      await stage('open_edge', async () => {
        const profile = resolve(scratch, 'edge-' + run);
        await mkdir(profile);
        const title = 'Pokemon YouTube Benchmark ' + randomUUID().slice(0, 8);
        const marker = 'data:text/html,' + encodeURIComponent('<title>' + title + '</title><h1>YouTube benchmark</h1>');
        browser = spawn(edge, ['--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-sync',
          '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--force-renderer-accessibility', '--lang=en-US',
          '--start-maximized', '--mute-audio', '--new-window', marker], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
        browser.on('error', error => {currentSample.browser_error = error.message;});
        let diagnostic = '';
        browser.stderr.on('data', data => {diagnostic = (diagnostic + data).slice(-2000);});
        const portFile = resolve(profile, 'DevToolsActivePort');
        const info = await poll(async () => {
          assert(!currentSample.browser_error, currentSample.browser_error);
          assert.equal(browser.exitCode, null, 'Dedicated Edge exited: ' + diagnostic);
          try {return (await readFile(portFile, 'utf8')).trim().split(/\r?\n/);} catch (error) {if (error.code !== 'ENOENT') throw error; return [];}
        }, lines => lines.length >= 2, 'Edge did not expose its dedicated debugger.', 20000);
        const base = 'http://127.0.0.1:' + Number(info[0]);
        const targets = await poll(async () => (await fetch(base + '/json/list', {signal: AbortSignal.timeout(5000)})).json(),
          list => list.some(item => item.type === 'page' && item.url === marker), 'The dedicated benchmark tab was not found.', 20000);
        page = await DebugConnection.open(targets.find(item => item.type === 'page' && item.url === marker).webSocketDebuggerUrl);
        browserDebug = await DebugConnection.open('ws://127.0.0.1:' + Number(info[0]) + info[1]);
        const version = await browserDebug.send('Browser.getVersion');
        report.environment.edge_version = version.product;
        const listed = await poll(() => windows({action: 'get_windows', query: title}), list => list.complete && list.windows.length === 1,
          'The uniquely named Edge window was not found.', 15000);
        win = listed.windows[0];
        assert.equal(win.process.toLowerCase(), 'msedge');
        const ui = await poll(() => windows({action: 'get_ui', window_id: win.id, window_ref: win.window_ref,
          query: 'Address and search bar', control_type: 'Edit'}),
        ui => ui.complete && !ui.truncated && ui.nodes.some(node => node.name === 'Address and search bar' && node.targetable),
        'Edge address bar was not accessibility-ready.', 20000);
        await windows({action: 'focus', ...target(ui, unique(ui, 'Address and search bar', 'focus'))});
      });
      const window = {window_id: win.id, window_ref: win.window_ref};
      await stage('open_youtube', async () => {
        const addressName = 'Address and search bar';
        const ui = await windows({action: 'get_ui', ...window, query: addressName, control_type: 'Edit'});
        const node = unique(ui, addressName, 'set_value');
        const url = 'https://www.youtube.com/?hl=en';
        await windows({steps: [
          {action: 'focus', ...target(ui, node)}, {action: 'set_value', ...target(ui, node), text: url},
          {action: 'get_ui', ...window, query: addressName, control_type: 'Edit', expect_value: url},
        ]});
        await api('computer', {action: 'key', text: 'Return', ...window});
        const loaded = await poll(observe, state => state.hostname === 'www.youtube.com' && state.pathname === '/' && state.buttons.includes('Search'),
          'YouTube did not finish opening.');
        const documents = await windows({action: 'get_ui', ...window, query: loaded.title, control_type: 'Document'});
        const document = unique(documents, loaded.title, 'focus');
        await windows({action: 'focus', ...target(documents, document)});
      });
      let candidates;
      await stage('search', async () => {
        const ui = await poll(() => windows({action: 'get_ui', ...window, query: 'Search'}),
          ui => ui.complete && !ui.truncated && ui.nodes.some(node => node.name === 'Search' && node.targetable && node.actions?.includes('set_value')),
          'The YouTube search field was not accessibility-ready.', 20000);
        const node = unique(ui, 'Search', 'set_value');
        await windows({steps: [
          {action: 'set_value', ...target(ui, node), text: options.query},
          {action: 'get_ui', ...window, query: 'Search', control_type: node.role, expect_value: options.query},
        ]});
        assert.equal((await observe()).search_query, options.query, 'YouTube field did not receive the exact query.');
        const buttons = await windows({action: 'get_ui', ...window, query: 'Search', control_type: 'Button'});
        const submit = unique(buttons, 'Search', 'invoke');
        await windows({action: 'invoke', ...target(buttons, submit)});
        candidates = (await poll(observe, state => state.pathname === '/results' && state.result_query === options.query && state.candidates.length,
          'YouTube search did not produce visible video results.')).candidates;
      });
      let selected;
      await stage('click_video', async () => {
        for (const candidate of candidates) {
          const ui = await windows({action: 'get_ui', ...window, query: candidate.title.slice(0, 100), control_type: 'Hyperlink'});
          assert(ui.complete && !ui.truncated, 'Video discovery was incomplete.');
          const links = ui.nodes.filter(node => node.targetable && node.actions?.includes('invoke')
            && (node.name === candidate.label.slice(0, 160) || node.name === candidate.title.slice(0, 160)));
          if (links.length === 1) {
            selected = candidate;
            currentSample.selected_video = candidate;
            await windows({action: 'invoke', ...target(ui, links[0])});
            break;
          }
        }
        assert(selected, 'No visible search result exposed a unique supported UI Automation link.');
        await poll(observe, state => state.pathname === '/watch' && state.video_id === selected.video_id,
          'The clicked video did not open its exact watch page.');
      });
      await stage('verify_playback', async () => {
        let previous;
        const verified = await poll(observe, state => {
          const verified = previous && playbackVerified(previous, state, selected.video_id);
          if (verified) currentSample.playback_evidence = {before: previous, after: state};
          else if (!contentPlaying(state, selected.video_id)) previous = undefined;
          else if (!previous || state.video.current_time < previous.video.current_time) previous = state;
          return verified;
        }, 'Selected content never reached verified playback; ads, buffering and paused media do not count.');
        assert(verified.video.current_time > 0);
      });
      currentSample.verified = true;
      currentSample.total_ms = performance.now() - begin;
      currentSample.mcp_calls = currentSample.calls.length;
      delete currentSample.active_stage;
      console.log('Verified run ' + run + ': ' + currentSample.total_ms.toFixed(1) + ' ms');
    } catch (error) {
      currentSample.error = error.message;
      currentSample.total_ms = performance.now() - begin;
      currentSample.mcp_calls = currentSample.calls.length;
      if (page) await observe().catch(() => {});
      if (page) {
        try {
          const capture = await page.send('Page.captureScreenshot', {format: 'png'});
          const path = output.replace(/\.json$/, '-failure.png');
          await writeFile(path, Buffer.from(capture.data, 'base64'));
          currentSample.failure_screenshot = relative(root, path);
        } catch {}
      }
      throw error;
    } finally {await cleanupBrowser(); await checkpoint();}
  }
  await session.call('pokemon', {action: 'done', message: 'YouTube benchmark verified video playback'});
  report.complete = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
  console.error('Benchmark failed: ' + error.message);
} finally {
  await cleanupBrowser();
  if (session) {
    if (originalWindow?.window_ref) await windows({action: 'activate', window_id: originalWindow.id, window_ref: originalWindow.window_ref}).catch(() => {});
    await session.client.close();
  }
  const verified = report.samples.filter(sample => sample.verified);
  report.summary = {verified_runs: verified.length, failed_runs: report.samples.length - verified.length,
    total: distribution(verified.map(sample => sample.total_ms)),
    stages: Object.fromEntries(stages.map(name => [name, distribution(verified.map(sample => sample.stage_ms[name]))]))};
  await checkpoint();
  const rows = ['total', ...stages].map(name => {
    const data = name === 'total' ? report.summary.total : report.summary.stages[name];
    return '| ' + name + ' | ' + (data ? data.median_ms.toFixed(1) + ' | ' + data.p95_ms.toFixed(1) : '— | —') + ' |';
  });
  await writeFile(output.replace(/\.json$/, '.md'), '# Edge → YouTube → search → watch benchmark\n\n'
    + 'Search: **' + options.query + '**. Verified ' + verified.length + '/' + options.runs + ' runs. '
    + (report.complete ? 'All requested runs passed.' : 'Incomplete: ' + report.error) + '\n\n'
    + '| Stage | Median ms | Observed p95 ms |\n| --- | ---: | ---: |\n' + rows.join('\n') + '\n\n'
    + Object.values(report.method).join('\n\n') + '\n\nRaw samples and playback evidence are in the adjacent JSON file.\n');
  const resolvedScratch = await realpath(scratch), resolvedTemp = await realpath(os.tmpdir());
  assert.equal(dirname(resolvedScratch).toLowerCase(), resolvedTemp.toLowerCase());
  assert(relative(resolvedTemp, resolvedScratch).startsWith('pokemon-youtube-'));
  await rm(resolvedScratch, {recursive: true, force: true, maxRetries: 10, retryDelay: 500});
  console.log('Saved benchmark: ' + relative(root, output));
}
