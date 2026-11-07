const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script through npm from the project root.');
const requested = process.argv.slice(2);
for (const repo of ['frontend', 'backend']) {
  const args = requested[0] === 'check' ? ['run', repo === 'frontend' ? 'check' : 'lint']
    : requested[0] === 'test' ? (repo === 'frontend' ? ['exec', '--', 'tsc', '-p', 'tsconfig.json'] : ['test']) : requested;
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd: path.join(root, repo), stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
  if (requested[0] === 'install' && repo === 'frontend') {
    const install = spawnSync(process.execPath, [path.join(root, 'scripts/ensure-electron.cjs')], {cwd: root, stdio: 'inherit'});
    if (install.status !== 0) process.exit(install.status || 1);
  }
}
