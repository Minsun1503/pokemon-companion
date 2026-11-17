const {pathToFileURL} = require('node:url');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
async function main() {
  const {harnessHome, loadConfig, saveConfig} = await import(pathToFileURL(path.join(root, 'backend/dist/harness/config.js')).href);
  const {HarnessStore} = await import(pathToFileURL(path.join(root, 'backend/dist/harness/store.js')).href);
  const {LocalJournal} = await import(pathToFileURL(path.join(root, 'backend/dist/learning/privacy.js')).href);
  const home = harnessHome(), config = await loadConfig(home);
  const store = new HarnessStore(new LocalJournal(path.join(home, 'store')));
  await store.open();
  try {
    const action = process.argv[2];
    if (action === 'token') {
      const token = process.env.POKEMON_BOOTSTRAP_TOKEN || '';
      if (!/^\d{5,15}:[A-Za-z0-9_-]{25,80}$/.test(token)) throw Error('Supply a valid bot token through POKEMON_BOOTSTRAP_TOKEN.');
      await store.putSecrets({TELEGRAM_BOT_TOKEN: token});
      if (process.env.ANTHROPIC_BASE_URL && process.env.ANTHROPIC_MODEL) {
        config.routes.remote_claude = {label: 'Claude configured endpoint', transport: 'anthropic', baseUrl: process.env.ANTHROPIC_BASE_URL, model: process.env.ANTHROPIC_MODEL, keyEnv: 'POKEMON_REMOTE_CLAUDE_KEY'};
        config.defaultRoute = 'remote_claude';
      }
      await saveConfig(home, config);
      console.log(JSON.stringify({tokenSaved: true, defaultRoute: config.defaultRoute}));
      return;
    }
    const token = store.secret('TELEGRAM_BOT_TOKEN');
    if (!token) throw Error('Bot token is not configured.');
    async function api(method, args = {}) {
      const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {method: 'POST', redirect: 'error', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(args), signal: AbortSignal.timeout(15000)});
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(`Telegram ${method} HTTP ${response.status}`);
      return result.result;
    }
    const bot = await api('getMe');
    if (action === 'leave-group') {
      if (config.telegram.allowedGroups.length !== 1) throw Error('Expected exactly one configured group to refresh.');
      await api('leaveChat', {chat_id: config.telegram.allowedGroups[0]});
      console.log(JSON.stringify({bot: bot.username, configuredGroupLeft: true}));
      return;
    }
    if (action === 'pair') {
      const nonce = process.argv[3];
      if (!/^[a-f0-9]{32}$/.test(nonce || '')) throw Error('Supply the pairing nonce.');
      const updates = await api('getUpdates', {timeout: 0, allowed_updates: ['message']});
      const commands = new Set([`/pair ${nonce}`, `/pair@${bot.username} ${nonce}`]);
      const pairs = updates.map(update => update.message).filter(message => commands.has(message?.text) && ['group', 'supergroup'].includes(message.chat.type) && message.from && !message.from.is_bot && !message.sender_chat);
      if (pairs.length !== 1) throw Error('Expected one matching owner/group pairing message.');
      config.telegram.allowedUsers = [String(pairs[0].from.id)];
      config.telegram.allowedGroups = [String(pairs[0].chat.id)];
      config.telegram.enabled = true;
      await saveConfig(home, config);
      console.log(JSON.stringify({bot: bot.username, owner: pairs[0].from.id, group: pairs[0].chat.id, title: pairs[0].chat.title, paired: true}));
      return;
    }
    if (action === 'status') {
      console.log(JSON.stringify({bot: bot.username, id: bot.id, canJoinGroups: bot.can_join_groups, allowedUsers: config.telegram.allowedUsers, allowedGroups: config.telegram.allowedGroups}));
      return;
    }
    throw Error('Use token, pair, status, or leave-group.');
  } finally {await store.close();}
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
