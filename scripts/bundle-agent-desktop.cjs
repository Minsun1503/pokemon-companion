const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const archives = {
  'darwin-arm64': ['aarch64-apple-darwin', '219813428bb1ad8decae172faed05c5964a2415170df402e2786ccfa6452ba82'],
  'darwin-x64': ['x86_64-apple-darwin', 'd9dc50226f28d7fc86a2f5b0945f0c206dff6c31e418907749f493b6f9e773e6'],
  'linux-x64': ['x86_64-unknown-linux-gnu', '591ae7f4a38479dc045df97e27447c0c8b530441730ab6b990e27c813162af44'],
};
async function bundleAgentDesktop(appRoot, platform, arch) {
  if (platform === 'win32') return;
  const [target, checksum] = archives[`${platform}-${arch}`] || [];
  if (!target) throw new Error('Unsupported native desktop bridge target');
  const directory = path.join(appRoot, 'runtime/agent-desktop');
  fs.mkdirSync(directory, {recursive: true});
  const response = await fetch(`https://github.com/vercel-labs/agent-desktop/releases/download/v1.2.0/agent-desktop-v1.2.0-${target}.tar.gz`, {signal: AbortSignal.timeout(120000)});
  if (!response.ok) throw new Error('Could not download the native desktop bridge');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== checksum) throw new Error('Native desktop bridge checksum mismatch');
  const archive = path.join(directory, '.download.tar.gz');
  fs.writeFileSync(archive, bytes);
  execFileSync('tar', ['-xzf', archive, '-C', directory], {stdio: 'inherit'});
  fs.unlinkSync(archive);
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if (entry.isFile()) fs.chmodSync(path.join(directory, entry.name), 0o755);
  }
  const binary = path.join(directory, 'agent-desktop');
  if (!fs.existsSync(binary)) throw new Error('The native desktop bridge was not extracted');
  const version = JSON.parse(execFileSync(binary, ['version'], {encoding: 'utf8'}));
  if (version.version !== '2.6' || version.ok !== true) throw new Error('The bundled desktop bridge uses an incompatible response contract');
  const license = await fetch('https://raw.githubusercontent.com/vercel-labs/agent-desktop/v1.2.0/LICENSE', {signal: AbortSignal.timeout(30000)});
  if (!license.ok) throw new Error('Could not include the desktop bridge license');
  fs.writeFileSync(path.join(directory, 'LICENSE'), await license.text());
  console.log('Bundled agent-desktop v1.2.0, response contract 2.6, and its platform helpers.');
}
module.exports = {bundleAgentDesktop};
