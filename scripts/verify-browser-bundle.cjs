const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createServer} = require('node:http');

// Shared by source and extracted-release tests. Exercise the MCP contract with
// an empty external Playwright cache, default channel, and a fresh user profile.
async function verifyBrowserBundle(client, appRoot, scratch) {
  const cache = path.join(appRoot, 'backend/node_modules/playwright-core/.local-browsers');
  const manifest = JSON.parse(fs.readFileSync(path.join(cache, 'pokemon-browser.json'), 'utf8'));
  assert.equal(manifest.platform, process.platform);
  assert.equal(manifest.arch, process.arch);
  assert.equal(manifest.playwright_version, JSON.parse(fs.readFileSync(path.join(appRoot, 'backend/node_modules/playwright/package.json'), 'utf8')).version);
  const executable = path.resolve(cache, manifest.executable);
  assert(!path.relative(cache, executable).startsWith('..'));
  assert(fs.statSync(executable).size > 0);
  const fixture = createServer((_request, response) => {
    response.writeHead(200, {'Content-Type': 'text/html'});
    response.end('<title>Bundled DOM browser</title><label for="song">Song</label><input id="song"><button onclick="localStorage.setItem(\'song\',document.querySelector(\'input\').value);document.querySelector(\'p\').textContent=\'Saved: \'+localStorage.getItem(\'song\')">Remember song</button><p id="ready"></p><script>document.querySelector(\'p\').textContent=localStorage.getItem(\'song\')?\'Saved: \'+localStorage.getItem(\'song\'):\'DOM ready\'</script>');
  });
  await new Promise(done => fixture.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${fixture.address().port}/`;
  const call = async (name, args) => {
    const result = await client.callTool({name, arguments: args});
    assert(!result.isError, JSON.stringify(result.content));
    return result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text);
  };
  let opened, adapter;
  try {
    // Visible first launch uses the full shipped binary, without choosing Edge.
    const profile = path.join(scratch, 'browser-profile');
    opened = await call('browser', {action: 'launch', profile});
    await call('browser', {action: 'navigate', page_id: opened.page_id, url});
    const snapshot = await call('browser', {action: 'snapshot', page_id: opened.page_id});
    const input = snapshot.nodes.find(node => node.name === 'Song' && node.tag === 'input');
    const button = snapshot.nodes.find(node => node.name === 'Remember song' && node.tag === 'button');
    assert(input && button, 'Bundled browser did not expose DOM elements');
    const filled = await call('browser', {action: 'fill', page_id: opened.page_id, ref: input.ref, text: 'Never Gonna Give You Up'});
    assert.equal(filled.verified, true);
    await call('browser', {action: 'click', page_id: opened.page_id, ref: button.ref});
    assert((await call('browser', {action: 'read_text', page_id: opened.page_id})).text.includes('Saved: Never Gonna Give You Up'));
    await call('browser', {action: 'close', session_id: opened.session_id});
    opened = undefined;
    // Headless launch uses the same full binary; no second headless download.
    opened = await call('browser', {action: 'launch', profile, headless: true});
    await call('browser', {action: 'navigate', page_id: opened.page_id, url});
    assert((await call('browser', {action: 'read_text', page_id: opened.page_id})).text.includes('Saved: Never Gonna Give You Up'), 'Persistent browser storage did not survive relaunch');
    await call('browser', {action: 'close', session_id: opened.session_id});
    opened = undefined;
    adapter = await call('app', {action: 'read', app_id: 'bundled-browser-fixture', web_urls: [url], web_ready_selector: '#ready'});
    assert.equal(adapter.method, 'playwright');
    assert.equal(adapter.surface, 'web');
    assert(adapter.data.text.text.includes('DOM ready'));
    console.log(`PASS: bundled Chromium ${manifest.chromium_version}; visible/headless DOM discovery, verified fill/click, persisted storage and app adapter, with no external browser cache.`);
    return manifest;
  } finally {
    if (opened) await call('browser', {action: 'close', session_id: opened.session_id});
    if (adapter?.data?.session_id) await call('browser', {action: 'close', session_id: adapter.data.session_id});
    await new Promise(done => fixture.close(done));
  }
}
module.exports = {verifyBrowserBundle};
