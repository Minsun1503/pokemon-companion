const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const release = path.join(root, 'release');
const version = require('../package.json').version;
const nodeVersion = 'v24.16.0';
const platform = process.platform;
const arch = process.arch;
const platformLabel = {win32: 'windows', darwin: 'macos', linux: 'linux'}[platform];
const name = `pokemon-companion-${version}-${platformLabel}-${arch}`;
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const json = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.cpSync(source, destination, {recursive: true, verbatimSymlinks: true, filter: file => {
    const base = path.basename(file);
    return base !== '.git' && !base.startsWith('.env') && !base.endsWith('.map');
  }});
}
function run(command, args, cwd = root) {
  execFileSync(command, args, {cwd, stdio: 'inherit', windowsHide: true});
}
function npm(args, cwd) {
  if (!process.env.npm_execpath) throw new Error('Run npm run package:desktop.');
  run(process.execPath, [process.env.npm_execpath, ...args], cwd);
}
async function download(url, file) {
  const response = await fetch(url, {signal: AbortSignal.timeout(120000)});
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}
function readme() {
  const open = platform === 'win32' ? 'Double-click Pokemon Companion.exe.'
    : platform === 'darwin' ? 'Open Pokemon Companion.app. The ZIP is specific to Intel (x64) or Apple Silicon (arm64).'
    : 'Open the executable named Pokemon Companion, or run ./"Pokemon Companion" from this folder. An X11 graphical desktop with user namespaces enabled is required.';
  const appRoot = platform === 'darwin' ? './Pokemon Companion.app/Contents/Resources/app' : '.';
  const node = platform === 'win32' ? '.\\runtime\\node.exe' : `"${appRoot}/runtime/node"`;
  const config = platform === 'win32' ? '.\\scripts\\config.cjs' : `"${appRoot}/scripts/config.cjs"`;
  return `Pokemon Companion ${version}\n\nExtract the entire ZIP before opening the app. Keep its accompanying files together.\n${open}\n\nClick the Pokemon to choose Switch or Exit. Use Ctrl+Shift+P or the tray menu to pause desktop controls. Talk is disabled and deferred. No model service or GitHub login is needed to open the companion.\n\nCONNECT YOUR AI CLIENT\nComputer tasks are driven by a connected MCP client such as Claude or Codex. The standalone companion does not run an AI task loop. To generate connection settings for this extracted location, run:\n${node} ${config} --output ./config\nMerge the generated config/claude-desktop.json or config/codex.toml into your client settings, then restart its MCP connection. The client will launch its own companion; close the standalone app first to avoid two pets. Regenerate these settings after moving the package.\n\nPLATFORM SUPPORT\nWindows native desktop controls are verified. macOS and Linux builds verify app startup and MCP connection; full desktop workflows on those systems remain experimental. Generic input requires the usual desktop permissions. macOS/Linux windows UI operations require the separately installed agent-desktop 2.6 bridge. Linux generic input requires X11; Wayland is not supported by the bundled input library.\nThese apps are not signed with a commercial Windows/macOS developer certificate. The macOS app is ad-hoc signed and is not notarized.\n\nSettings and app.log are stored in your OS application-data folder under pokemon-companion. Existing conversations are not removed.\n\nUnofficial Pokemon fan project. See NOTICE.txt, LICENSE, and THIRD_PARTY.md for asset and software attribution.\n`;
}

async function main() {
  if (!platformLabel || !['x64', 'arm64'].includes(arch) || (platform !== 'darwin' && arch !== 'x64')) {
    throw new Error('Build on Windows x64, Linux x64, or macOS x64/arm64.');
  }
  const output = path.join(release, name);
  if (fs.existsSync(output) || fs.existsSync(output + '.zip')) throw new Error(`Release output already exists: ${output}`);
  fs.mkdirSync(release, {recursive: true});
  const stage = fs.mkdtempSync(path.join(release, '.desktop-stage-'));
  const app = platform === 'darwin' ? path.join(stage, 'Pokemon Companion.app') : undefined;
  const appRoot = app ? path.join(app, 'Contents/Resources/app') : stage;
  fs.mkdirSync(appRoot, {recursive: true});
  console.log(`Packaging ${name} with native ${platform}/${arch} dependencies...`);

  for (const file of ['package.json', 'package-lock.json', 'LICENSE']) {
    copy(path.join(root, 'backend', file), path.join(appRoot, 'backend', file));
  }
  const backendManifest = JSON.parse(fs.readFileSync(path.join(appRoot, 'backend/package.json')));
  json(path.join(appRoot, 'backend/package.json'), {...backendManifest, version});
  const backendLock = JSON.parse(fs.readFileSync(path.join(appRoot, 'backend/package-lock.json')));
  backendLock.version = backendLock.packages[''].version = version;
  json(path.join(appRoot, 'backend/package-lock.json'), backendLock);
  copy(path.join(root, 'backend/dist'), path.join(appRoot, 'backend/dist'));
  npm(['ci', '--omit=dev', '--no-audit', '--no-fund'], path.join(appRoot, 'backend'));
  for (const dir of ['build', 'pets', 'assets']) copy(path.join(root, 'frontend', dir), path.join(appRoot, 'frontend', dir));
  // Ship only repository defaults. Never copy a developer profile, keys, chat history or tunnel address.
  copy(path.join(root, 'frontend/config/setting.json'), path.join(appRoot, 'frontend/config/setting.json'));
  copy(path.join(root, 'frontend/LICENSE'), path.join(appRoot, 'frontend/LICENSE'));
  const electronSource = path.join(root, 'frontend/node_modules/electron/dist');
  const electronTarget = path.join(appRoot, 'frontend/node_modules/electron/dist');
  if (platform === 'darwin') {
    // Use the native copier for framework symlinks and app bundle metadata.
    fs.mkdirSync(path.dirname(electronTarget), {recursive: true});
    run('ditto', [electronSource, electronTarget]);
    const framework = 'Electron.app/Contents/Frameworks/Electron Framework.framework/Electron Framework';
    if (!fs.existsSync(path.join(electronTarget, framework))) throw new Error('The copied Electron framework is incomplete.');
  } else {
    copy(electronSource, electronTarget);
  }
  json(path.join(appRoot, 'frontend/package.json'), {name: 'pokemon-companion', version, main: 'main.js'});
  fs.writeFileSync(path.join(appRoot, 'frontend/main.js'), "require('./build/main/companion/index.js');\n");
  json(path.join(appRoot, 'package.json'), {name: 'pokemon-computer-companion', version, private: true});
  copy(path.join(root, 'scripts/config.cjs'), path.join(appRoot, 'scripts/config.cjs'));

  const runtime = path.join(appRoot, 'runtime');
  fs.mkdirSync(runtime, {recursive: true});
  const nodeFile = platform === 'win32' ? `win-${arch}/node.exe` : `node-${nodeVersion}-${platform}-${arch}.tar.gz`;
  const base = `https://nodejs.org/dist/${nodeVersion}/`;
  const sums = await fetch(base + 'SHASUMS256.txt', {signal: AbortSignal.timeout(30000)});
  if (!sums.ok) throw new Error('Could not verify the Node runtime.');
  const expected = (await sums.text()).split('\n').find(line => line.endsWith('  ' + nodeFile))?.split(/\s+/)[0];
  if (!expected) throw new Error(`Missing upstream checksum for ${nodeFile}`);
  const archive = path.join(stage, platform === 'win32' ? '.node-download.exe' : '.node-download.tar.gz');
  await download(base + nodeFile, archive);
  if (hash(archive) !== expected) throw new Error('Node runtime checksum mismatch.');
  if (platform === 'win32') {
    fs.renameSync(archive, path.join(runtime, 'node.exe'));
    await download(`https://raw.githubusercontent.com/nodejs/node/${nodeVersion}/LICENSE`, path.join(runtime, 'LICENSE'));
  } else {
    const extraction = fs.mkdtempSync(path.join(release, '.node-extract-'));
    run('tar', ['-xzf', archive, '-C', extraction]);
    const nodeRoot = path.join(extraction, `node-${nodeVersion}-${platform}-${arch}`);
    copy(path.join(nodeRoot, 'bin/node'), path.join(runtime, 'node'));
    copy(path.join(nodeRoot, 'LICENSE'), path.join(runtime, 'LICENSE'));
    fs.chmodSync(path.join(runtime, 'node'), 0o755);
    // These exact scratch paths were created here and are verified before recursive removal.
    if (path.dirname(fs.realpathSync(extraction)) !== fs.realpathSync(release)) throw new Error('Invalid extraction path');
    fs.rmSync(extraction, {recursive: true});
    fs.unlinkSync(archive);
  }

  if (platform === 'win32') {
    const sharp = require(path.join(root, 'frontend/node_modules/sharp'));
    const png = await sharp(path.join(root, 'frontend/assets/icon.png')).resize(256, 256).png().toBuffer();
    const ico = Buffer.alloc(22);
    ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
    ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
    fs.writeFileSync(path.join(stage, 'app.ico'), Buffer.concat([ico, png]));
    run(path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), [
      '/nologo', '/target:winexe', '/platform:x64', '/reference:System.Windows.Forms.dll',
      `/win32icon:${path.join(stage, 'app.ico')}`, `/out:${path.join(stage, 'Pokemon Companion.exe')}`,
      path.join(root, 'packaging/desktop-launcher.cs'),
    ]);
  } else {
    const executable = app ? path.join(app, 'Contents/MacOS/Pokemon Companion') : path.join(stage, 'Pokemon Companion');
    fs.mkdirSync(path.dirname(executable), {recursive: true});
    run(platform === 'darwin' ? 'clang' : 'cc', ['-O2', '-Wall', '-Wextra', path.join(root, 'packaging/desktop-launcher.c'), '-o', executable]);
    fs.chmodSync(executable, 0o755);
    if (app) {
      const icon = path.join(app, 'Contents/Resources/icon.icns');
      const iconset = path.join(stage, '.icon.iconset');
      fs.mkdirSync(iconset);
      const sharp = require(path.join(root, 'frontend/node_modules/sharp'));
      for (const size of [16, 32, 128, 256, 512]) {
        for (const scale of [1, 2]) {
          await sharp(path.join(root, 'frontend/assets/icon.png')).resize(size * scale, size * scale).png().toFile(path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`));
        }
      }
      run('iconutil', ['-c', 'icns', iconset, '-o', icon]);
      if (path.dirname(fs.realpathSync(iconset)) !== fs.realpathSync(stage)) throw new Error('Invalid icon path');
      fs.rmSync(iconset, {recursive: true});
      fs.writeFileSync(path.join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.pokemon.companion</string><key>CFBundleName</key><string>Pokemon Companion</string><key>CFBundleDisplayName</key><string>Pokemon Companion</string><key>CFBundleExecutable</key><string>Pokemon Companion</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>${version}</string><key>CFBundleIconFile</key><string>icon.icns</string><key>LSUIElement</key><true/><key>LSMinimumSystemVersion</key><string>12.0</string></dict></plist>\n`);
      run('codesign', ['--force', '--deep', '--sign', '-', app]);
      run('codesign', ['--verify', '--deep', '--strict', app]);
    } else {
      fs.chmodSync(path.join(appRoot, 'frontend/node_modules/electron/dist/electron'), 0o755);
    }
  }
  for (const file of ['LICENSE', 'THIRD_PARTY.md']) copy(path.join(root, file), path.join(stage, file));
  fs.writeFileSync(path.join(stage, 'NOTICE.txt'), 'Unofficial Pokemon fan project. Assets belong to Nintendo / Creatures Inc. / GAME FREAK. Original frontend and backend MIT licenses are included. Electron, Node and dependencies retain their own licenses.\n');
  fs.writeFileSync(path.join(stage, 'README.txt'), readme());
  json(path.join(stage, 'build-info.json'), {version, platform, arch, nodeVersion, chatEnabled: false, builtAt: new Date().toISOString(), sourceCommit: process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim()});
  fs.renameSync(stage, output);
  const zip = output + '.zip';
  if (platform === 'win32') {
    const quote = value => "'" + value.replace(/'/g, "''") + "'";
    const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory(${quote(output)}, ${quote(zip)}, [System.IO.Compression.CompressionLevel]::Optimal, $true)`;
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
  } else if (platform === 'darwin') {
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', output, zip]);
  } else {
    run('zip', ['-q', '-r', '-y', zip, name], release);
  }
  fs.writeFileSync(zip + '.sha256', `${hash(zip)}  ${path.basename(zip)}\n`);
  console.log(`Ready: ${zip}`);
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
