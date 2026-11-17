// An isolated renderer fixture, never a real action authorization endpoint.
const {app} = require('electron');
const {mkdirSync, writeFileSync} = require('node:fs');
const path = require('node:path');
const {CompanionApprovals} = require('../frontend/build/main/companion/approval.js');
const root = path.resolve(__dirname, '../frontend');
app.setPath('userData', process.env.POKEMON_APPROVAL_FIXTURE_PROFILE);
app.whenReady().then(async () => {
  const approvals = new CompanionApprovals(root, app.getPath('userData'), async () => {});
  await approvals.check({action_id: 'synthetic', digest: 'a'.repeat(64), scope_hash: 'b'.repeat(64), tool: 'browser', operation: 'click', origin: 'https://example.test', path: '/chat/song-review', target: 'Send message (app-provided label)', input_preview: 'This is a synthetic test message about the repository.', target_length: 33, input_length: 55, conversation: 'Synthetic review', scope_allowed: true, input_hash: 'c'.repeat(64), state_hash: 'd'.repeat(64)});
  const entry = [...approvals.windows.values()][0];
  await new Promise(resolve => setTimeout(resolve, 200));
  const screenshot = await entry.window.webContents.capturePage();
  mkdirSync(path.dirname(process.env.POKEMON_APPROVAL_FIXTURE_IMAGE), {recursive: true});
  writeFileSync(process.env.POKEMON_APPROVAL_FIXTURE_IMAGE, screenshot.toPNG());
  approvals.close();
  app.quit();
}).catch(error => {console.error(error); app.exit(1);});
