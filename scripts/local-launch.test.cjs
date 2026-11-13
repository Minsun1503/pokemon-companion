const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');
const launcher = path.join(__dirname, 'start-mcp.cjs');
function temporary(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    const target = fs.realpathSync(directory);
    assert.equal(path.dirname(target).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert(path.basename(target).startsWith(prefix));
    fs.rmSync(target, {recursive: true, force: true});
  });
  return directory;
}

test('launch pairs backend, cwd, and UI despite unrelated cwd and stale UI override', t => {
  const root = temporary(t, 'pokemon-launch-');
  fs.mkdirSync(path.join(root, 'backend/dist'), {recursive: true});
  fs.mkdirSync(path.join(root, 'frontend/build/main/companion'), {recursive: true});
  fs.writeFileSync(path.join(root, 'frontend/package.json'), '{}');
  fs.writeFileSync(path.join(root, 'frontend/build/main/companion/index.js'), '');
  fs.writeFileSync(path.join(root, 'backend/dist/main.js'), 'console.log(JSON.stringify({cwd:process.cwd(),frontend:process.env.POKEMON_FRONTEND_DIR}));');
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(launcher)}).launch(${JSON.stringify(root)})`], {
    cwd: os.tmpdir(), env: {...process.env, POKEMON_FRONTEND_DIR: path.join(root, 'old-copy')}, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {cwd: fs.realpathSync(root), frontend: path.join(root, 'frontend')});
  assert.match(result.stderr, /Pokémon MCP checkout:/);
});

test('an unbuilt checkout fails without starting another copy', t => {
  const root = temporary(t, 'pokemon-launch-');
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(launcher)}).launch(${JSON.stringify(root)}).catch(e=>{console.error(e.message);process.exitCode=1})`], {encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Run npm run setup and npm run build/);
});

test('generated configs use the paired launcher and explicit checkout', t => {
  const output = temporary(t, 'pokemon-config-');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'config.cjs'), '--output', output], {cwd: os.tmpdir(), encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const server = JSON.parse(fs.readFileSync(path.join(output, 'claude-desktop.json'))).mcpServers['pokemon-computer'];
  assert.deepEqual(server.args, [launcher]);
  assert.equal(server.cwd, path.resolve(__dirname, '..'));
  assert.equal(server.env.POKEMON_FRONTEND_DIR, path.join(server.cwd, 'frontend'));
  const toml = fs.readFileSync(path.join(output, 'codex.toml'), 'utf8');
  assert(toml.includes(launcher.replaceAll('\\', '/')));
  assert.match(toml, /\[mcp_servers\.pokemon_computer\.env\]/);
});
