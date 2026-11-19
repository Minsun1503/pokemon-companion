const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {addAgentLauncher} = require('./package-agent.cjs');

for (const platform of ['win32', 'darwin', 'linux']) {
  test(`portable agent launcher resolves the ${platform} app root`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pokemon-launcher-test-'));
    const checked = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
    assert(checked.startsWith('pokemon-launcher-test-') && !checked.startsWith('..'));
    const appRoot = platform === 'darwin' ? path.join(root, 'Pokemon Companion.app/Contents/Resources/app') : root;
    try {
      addAgentLauncher(root, appRoot, platform);
      fs.mkdirSync(path.join(appRoot, 'backend/dist/harness'), {recursive: true});
      fs.writeFileSync(path.join(appRoot, 'backend/package.json'), '{"type":"module"}');
      fs.writeFileSync(path.join(appRoot, 'backend/dist/harness/main.js'), 'export async function main(mode, root) {console.log(JSON.stringify({mode, root, cwd: process.cwd()}));}\n');
      const output = JSON.parse(execFileSync(process.execPath, [path.join(appRoot, 'scripts/harness.cjs'), 'setup'], {cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true}));
      assert.equal(output.mode, 'setup');
      assert.equal(output.root, appRoot);
      assert.equal(output.cwd, appRoot);
      assert(fs.existsSync(path.join(root, 'AGENT-SETUP.md')));
      if (platform === process.platform && platform === 'win32') {
        fs.mkdirSync(path.join(appRoot, 'runtime'), {recursive: true});
        const node = path.join(appRoot, 'runtime/node.exe');
        try {fs.linkSync(process.execPath, node);} catch {fs.copyFileSync(process.execPath, node);}
        const launched = JSON.parse(execFileSync('cmd.exe', ['/d', '/c', path.join(root, 'Start Pokemon Agent.cmd')], {encoding: 'utf8', windowsHide: true}));
        assert.equal(launched.root, appRoot);
        assert.equal(launched.mode, 'setup');
      }
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
}

test('DeepSeek portable includes the installer interview and single-provider profile', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pokemon-launcher-test-'));
  const checked = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
  assert(checked.startsWith('pokemon-launcher-test-') && !checked.startsWith('..'));
  try {
    addAgentLauncher(root, root, 'win32', {deepSeekOnly: true});
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'agent-profile.json'))).id, 'deepseek-telegram');
    for (const file of ['AGENTS.md', 'START-HERE.md', 'AGENT-SETUP.md', 'GROUP-WELCOME.vi.md']) assert(fs.statSync(path.join(root, file)).size > 100);
    const guide = fs.readFileSync(path.join(root, 'AGENT-SETUP.md'), 'utf8');
    assert(guide.includes('pairing approve') && guide.includes('npm run agent -- setup'));
    assert(guide.includes('Không tự nhập key/token'));
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('gateway exits through its shutdown handler when its service owner disappears', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pokemon-launcher-test-'));
  const checked = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
  assert(checked.startsWith('pokemon-launcher-test-') && !checked.startsWith('..'));
  let childPid;
  try {
    addAgentLauncher(root, root, process.platform);
    fs.mkdirSync(path.join(root, 'backend/dist/harness'), {recursive: true});
    fs.writeFileSync(path.join(root, 'backend/package.json'), '{"type":"module"}');
    const stopped = path.join(root, 'stopped.json');
    fs.writeFileSync(path.join(root, 'backend/dist/harness/main.js'), `import fs from 'node:fs'; export async function main() {process.on('SIGTERM', () => {fs.writeFileSync(${JSON.stringify(stopped)}, '"gracefully stopped"'); process.exit(0);}); setInterval(() => {}, 1000);}`);
    const starter = path.join(root, 'start.cjs');
    fs.writeFileSync(starter, `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,[${JSON.stringify(path.join(root, 'scripts/harness.cjs'))},'run'],{env:{...process.env,POKEMON_AGENT_PARENT_PID:String(process.pid)},detached:true,stdio:'ignore',windowsHide:true}); console.log(child.pid); child.unref();`);
    childPid = Number(execFileSync(process.execPath, [starter], {encoding: 'utf8', windowsHide: true}));
    assert(Number.isSafeInteger(childPid) && childPid > 0);
    const deadline = Date.now() + 8000;
    while (!fs.existsSync(stopped) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(fs.readFileSync(stopped, 'utf8'), '"gracefully stopped"');
  } finally {
    if (childPid) try {process.kill(childPid);} catch {}
    fs.rmSync(root, {recursive: true, force: true});
  }
});
