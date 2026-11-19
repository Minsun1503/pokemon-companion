// One-command install/update: `npm run install:local` on a new machine, `npm run update` afterwards.
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script through npm from the project root.');
const pull = process.argv.includes('--pull');

function run(command, args, label) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {cwd: root, stdio: 'inherit'});
  if (result.status !== 0) {
    console.error(`\n${label} failed (exit ${result.status}).`);
    process.exit(result.status || 1);
  }
}

if (pull) {
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {cwd: root, encoding: 'utf8'});
  if (status.stdout.trim()) {
    console.error('Tracked files have local changes. Commit or stash them first, then run npm run update again:\n' + status.stdout);
    process.exit(1);
  }
  run('git', ['pull', '--ff-only'], 'git pull');
}

run(process.execPath, [npmCli, 'run', 'setup'], 'npm run setup');
run(process.execPath, [npmCli, 'run', 'build'], 'npm run build');

// Project-level MCP config for Claude Code, pointing at this checkout.
const config = {mcpServers: {'pokemon-companion': {command: process.execPath, args: [path.join(root, 'scripts', 'start-mcp.cjs')]}}};
fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify(config, null, 2) + '\n');
console.log(`\nWrote ${path.join(root, '.mcp.json')}`);
console.log('Done. Reconnect pokemon-companion in Claude (/mcp → Reconnect) to load the new build.');
