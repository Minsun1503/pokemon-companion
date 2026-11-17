import {createInterface} from 'node:readline/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {connect} from './client.mjs';

// A capture-only console. It deliberately offers no execute or reconciliation command.
const root = fileURLToPath(new URL('../', import.meta.url));
const option = name => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const profile = resolve(option('--profile') || resolve(process.env.LOCALAPPDATA || root, 'pokemon-companion/browser/api-demo'));
const decode = result => result.structuredContent ?? JSON.parse(result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'));
let session, sessionId, pageId, watchPage, taskId, timer, polling = false, previous = '';
const call = async (name, args) => decode(await session.call(name, {...args, ...(taskId ? {task_id: taskId} : {})}));
const input = createInterface({input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY});
const show = data => console.log(JSON.stringify(data, null, 2));
async function selectPage(id) {
  const tabs = (await call('browser', {action: 'tabs', session_id: sessionId})).pages;
  const candidates = tabs.filter(tab => /^https?:/.test(tab.url) && (!id || tab.page_id === id));
  if (candidates.length !== 1) throw new Error('Use tabs, then watch <page_id> [url_prefix] to choose exactly one HTTP(S) page.');
  return candidates[0];
}
async function status() {
  if (!watchPage) return show({watching: false, instruction: 'Sign in yourself, then type watch.'});
  const result = await call('api', {action: 'watch_read', page_id: watchPage, max_chars: 16000});
  previous = JSON.stringify(result.operations.map(row => [row.operation_id, row.revision]));
  show(result);
}
try {
  session = await connect({root, args: [resolve(root, 'scripts/start-mcp.cjs')], env: {...process.env,
    POKEMON_API_DIR: resolve(profile, 'api-catalog'), POKEMON_LEARNING_DIR: resolve(profile, 'learning'),
    POKEMON_USER_DATA_DIR: resolve(profile, 'companion'), POKEMON_APPROVAL_WAIT: 'on'}});
  const learning = await call('learning', {action: 'status'});
  if (learning.enabled) {
    taskId = (await call('learning', {action: 'begin', query: option('--task-query') || 'Watch my web demonstration once and update captured APIs when I click something new.',
      parameters: {profile, mode: 'observe-only'}})).task_id;
  }
  const tools = await session.client.listTools();
  if (!tools.tools.some(tool => tool.name === 'api')) throw new Error('Build the active checkout before starting the API watcher.');
  const launched = await call('browser', {action: 'launch', headless: false, profile});
  sessionId = launched.session_id;
  pageId = launched.page_id;
  show({browser_opened: true, page_id: pageId, commands: ['open <https URL>', 'tabs', 'watch [page_id] [url_prefix]', 'status', 'inspect <operation_id> <revision>', 'stop', 'quit'],
    instruction: 'Sign in yourself in the visible browser. Type watch only after login. New requests are saved while the console stays open; nothing is replayed.'});
  if (option('--url')) {
    await call('browser', {action: 'navigate', page_id: pageId, url: option('--url')}).then(show).catch(error => console.error(error.message));
  }
  timer = setInterval(async () => {
    if (!watchPage || polling) return;
    polling = true;
    try {
      const result = await call('api', {action: 'watch_read', page_id: watchPage, max_chars: 16000});
      const next = JSON.stringify(result.operations.map(row => [row.operation_id, row.revision]));
      if (next !== previous) {
        previous = next;
        show({catalog_updated: true, ...result});
      }
    } catch (error) {console.error(error.message);} finally {polling = false;}
  }, 3000);
  for await (const line of input) {
    const [command, ...args] = line.trim().split(/\s+/);
    try {
      if (command === 'quit') break;
      if (command === 'tabs') show(await call('browser', {action: 'tabs', session_id: sessionId}));
      else if (command === 'open') show(await call('browser', {action: 'navigate', page_id: pageId, url: args[0]}));
      else if (command === 'watch') {
        const tab = await selectPage(args[0]);
        if (watchPage) await call('api', {action: 'watch_stop', page_id: watchPage});
        show(await call('api', {action: 'watch_start', page_id: tab.page_id, url_prefix: args[1] || new URL(tab.url).origin + '/'}));
        watchPage = tab.page_id;
        await status();
      } else if (command === 'status') await status();
      else if (command === 'inspect') {
        if (!watchPage) throw new Error('Start a watcher first.');
        show(await call('api', {action: 'inspect', page_id: watchPage, operation_id: args[0], revision: Number(args[1])}));
      } else if (command === 'stop') {
        if (watchPage) show(await call('api', {action: 'watch_stop', page_id: watchPage}));
        watchPage = undefined;
      } else if (command) console.log('Commands: open, tabs, watch, status, inspect, stop, quit.');
    } catch (error) {console.error(error.message);}
  }
} finally {
  clearInterval(timer);
  input.close();
  if (watchPage) await call('api', {action: 'watch_stop', page_id: watchPage}).catch(() => {});
  if (taskId) await call('learning', {action: 'finish', task_id: taskId, outcome: 'unknown', summary: 'Capture console closed. Demonstration and replay outcomes require separate verification.'}).catch(() => {});
  await session?.client.close();
}
