const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {addClientMetadata} = require('./client-package-metadata.cjs');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function copy(source, target) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.cpSync(source, target, {recursive: true, dereference: true, filter: file => {
    const base = path.basename(file);
    return base !== '.git' && base !== '.bin' && !base.startsWith('.env') && !base.endsWith('.map');
  }});
}
async function packageClientBundles({root, appRoot, release, version, platform, arch}) {
  const label = {win32: 'windows', darwin: 'macos', linux: 'linux'}[platform];
  if (!process.env.npm_execpath) throw new Error('Run npm run package:desktop.');
  const output = path.join(release, `pokemon-companion-${version}-plugin-${label}-${arch}.zip`);
  if (fs.existsSync(output)) throw new Error(`Client bundle already exists: ${output}`);
  const stage = fs.mkdtempSync(path.join(release, '.client-stage-'));
  copy(path.join(appRoot, 'backend'), path.join(stage, 'backend'));
  for (const dir of ['build', 'pets', 'assets', 'config']) copy(path.join(appRoot, 'frontend', dir), path.join(stage, 'frontend', dir));
  for (const file of ['package.json', 'main.js', 'LICENSE']) copy(path.join(appRoot, 'frontend', file), path.join(stage, 'frontend', file));
  copy(path.join(appRoot, 'package.json'), path.join(stage, 'package.json'));
  copy(path.join(appRoot, 'runtime'), path.join(stage, 'runtime'));
  const electron = path.join(appRoot, 'frontend/node_modules/electron/dist');
  if (platform === 'darwin') {
    const archive = path.join(stage, 'runtime/electron.zip');
    execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', electron, archive], {stdio: 'inherit'});
    fs.writeFileSync(path.join(stage, 'runtime/electron.json'), JSON.stringify({version: require('../frontend/node_modules/electron/package.json').version, sha256: hash(archive), executable: 'Electron.app/Contents/MacOS/Electron'}, null, 2));
  } else copy(electron, path.join(stage, 'frontend/node_modules/electron/dist'));
  copy(path.join(root, 'packaging/client-launch.cjs'), path.join(stage, 'client-launch.cjs'));
  for (const file of ['LICENSE', 'THIRD_PARTY.md', 'NOTICE.txt']) copy(path.join(root, file), path.join(stage, file));
  fs.writeFileSync(path.join(stage, 'AGENT_GUIDE.md'), `Package version: ${version}\nResponse contract version: 1\n\n` + fs.readFileSync(path.join(root, 'packaging/agent-guide.md'), 'utf8'));
  addClientMetadata(stage, stage, platform, version, 'client-launch.cjs');
  copy(path.join(stage, 'CLIENT-INSTALL.txt'), path.join(stage, 'README.txt'));
  execFileSync(process.execPath, [process.env.npm_execpath, 'exec', '--yes', '--package=@anthropic-ai/mcpb@2.1.2', '--', 'mcpb', 'pack', stage, output], {cwd: root, stdio: 'inherit', windowsHide: true});
  fs.writeFileSync(output + '.sha256', `${hash(output)}  ${path.basename(output)}\n`);
  if (platform !== 'linux') {
    const mcpb = path.join(release, `pokemon-companion-${version}-claude-${label}-${arch}.mcpb`);
    fs.copyFileSync(output, mcpb);
    fs.writeFileSync(mcpb + '.sha256', `${hash(mcpb)}  ${path.basename(mcpb)}\n`);
    console.log(`Claude Desktop extension: ${mcpb}`);
  }
  console.log(`Desktop local-plugin package: ${output}`);
  if (path.dirname(fs.realpathSync(stage)) !== fs.realpathSync(release) || !path.basename(stage).startsWith('.client-stage-')) throw new Error('Invalid client staging path');
  fs.rmSync(stage, {recursive: true});
}
module.exports = {packageClientBundles};
