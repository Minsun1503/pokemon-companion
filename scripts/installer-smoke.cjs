const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const release = path.join(root, 'release');
const bundle = path.join(release, 'pokemon-companion-win32-x64');
const isolated = fs.mkdtempSync(path.join(release, '.verify-install-'));
try {
  fs.mkdirSync(path.join(isolated, 'codex'));
  fs.mkdirSync(path.join(isolated, 'claude'));
  for (const client of ['Codex', 'ClaudeCode']) {
    // Use the clients' documented configuration roots to avoid touching real accounts.
    const env = {...process.env, CODEX_HOME: path.join(isolated, 'codex'), CLAUDE_CONFIG_DIR: path.join(isolated, 'claude')};
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(bundle, 'install-client.ps1'), '-Client', client], {cwd: bundle, env, stdio: 'inherit', windowsHide: true});
    assert.equal(result.status, 0, `${client} installer failed in an isolated configuration.`);
  }
  console.log('PASS: real Claude Code and Codex installers registered the marketplace and installed the plugin in isolated configuration folders.');
} finally {
  assert.equal(path.dirname(fs.realpathSync(isolated)), fs.realpathSync(release));
  assert(path.basename(isolated).startsWith('.verify-install-'));
  fs.rmSync(isolated, {recursive: true, force: true});
}
