const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const frontend = path.resolve(__dirname, '../frontend');
const electronDir = path.join(frontend, 'node_modules/electron');
const dist = path.join(electronDir, 'dist');
const binary = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
const required = process.platform === 'darwin' ? [
  binary,
  'Electron.app/Contents/Frameworks/Electron Framework.framework/Electron Framework',
  'Electron.app/Contents/Resources/default_app.asar',
] : [binary, 'resources/default_app.asar', 'icudtl.dat'];
const complete = () => required.every(file => {
  try { return fs.statSync(path.join(dist, file)).isFile() && fs.statSync(path.join(dist, file)).size > 0; }
  catch { return false; }
});
async function main() {
  if (complete()) return;
  spawnSync(process.execPath, [path.join(electronDir, 'install.js')], {cwd: frontend, stdio: 'inherit'});
  if (complete()) return;
  // Some Node 24/extract-zip combinations exit with a partially extracted archive.
  // Use the native extractor and verify the executable before accepting setup.
  const {downloadArtifact} = createRequire(path.join(electronDir, 'package.json'))('@electron/get');
  const {version} = require(path.join(electronDir, 'package.json'));
  const archive = await downloadArtifact({version, artifactName: 'electron', platform: process.platform, arch: process.arch, checksums: require(path.join(electronDir, 'checksums.json'))});
  fs.mkdirSync(dist, {recursive: true});
  let extracted;
  if (process.platform === 'win32') {
    const quote = (value) => "'" + value.replace(/'/g, "''") + "'";
    const command = `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(dist)} -Force`;
    extracted = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {windowsHide: true, stdio: 'inherit'});
  } else {
    extracted = spawnSync('unzip', ['-oq', archive, '-d', dist], {stdio: 'inherit'});
  }
  if (extracted.status !== 0 || !complete()) throw new Error('Electron runtime extraction failed or left required framework/resources missing.');
  fs.writeFileSync(path.join(electronDir, 'path.txt'), binary);
}
main().catch((error) => { console.error(error); process.exit(1); });
