const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {execFileSync} = require('node:child_process');

// Store Playwright's locked browser revision inside the backend. Packages work
// offline after extraction and never depend on the builder's browser cache.
function ensureBrowser(backend = path.resolve(__dirname, '../backend'), sourceBackend) {
  const fromBackend = createRequire(path.join(backend, 'package.json'));
  const core = path.dirname(fromBackend.resolve('playwright-core/package.json'));
  const cache = path.join(core, '.local-browsers');
  if (sourceBackend) {
    const fromSource = createRequire(path.join(sourceBackend, 'package.json'));
    const sourceCache = path.join(path.dirname(fromSource.resolve('playwright-core/package.json')), '.local-browsers');
    const sourceManifest = path.join(sourceCache, 'pokemon-browser.json');
    if (path.resolve(sourceCache) !== path.resolve(cache) && fs.existsSync(sourceManifest)) {
      const recorded = JSON.parse(fs.readFileSync(sourceManifest, 'utf8'));
      if (recorded.playwright_version === fromBackend('playwright/package.json').version && recorded.platform === process.platform && recorded.arch === process.arch) {
        fs.cpSync(sourceCache, cache, {recursive: true, verbatimSymlinks: true, filter: file => path.basename(file) !== '.links'});
      }
    }
  }
  const env = {...process.env, PLAYWRIGHT_BROWSERS_PATH: '0'};
  execFileSync(process.execPath, [path.join(path.dirname(fromBackend.resolve('playwright/package.json')), 'cli.js'), 'install', '--no-shell', 'chromium'], {
    cwd: backend, env, stdio: 'inherit', windowsHide: true,
  });
  // Playwright's registry reads the environment at import time. Resolve in a
  // fresh process rather than duplicating platform-specific executable paths.
  const executable = execFileSync(process.execPath, ['-e',
    "process.stdout.write(require(process.argv[1]).chromium.executablePath())", fromBackend.resolve('playwright')],
  {cwd: backend, env, encoding: 'utf8', windowsHide: true}).trim();
  const relative = path.relative(cache, executable);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(executable).isFile() || !fs.statSync(executable).size) {
    throw new Error('The bundled Chromium executable is missing or outside its package.');
  }
  const browser = JSON.parse(fs.readFileSync(path.join(core, 'browsers.json'), 'utf8')).browsers.find(item => item.name === 'chromium');
  const manifest = {
    format: 1, playwright_version: fromBackend('playwright/package.json').version,
    chromium_version: browser.browserVersion, revision: browser.revision,
    platform: process.platform, arch: process.arch, executable: relative.replaceAll('\\', '/'),
  };
  fs.writeFileSync(path.join(cache, 'pokemon-browser.json'), JSON.stringify(manifest, null, 2) + '\n');
  // Installer link markers contain the builder's absolute checkout path. They
  // are not needed at runtime; remove only this verified scratch directory.
  const links = path.join(cache, '.links');
  if (fs.existsSync(links)) {
    if (path.dirname(fs.realpathSync(links)) !== fs.realpathSync(cache)) throw new Error('Invalid browser installer links path');
    fs.rmSync(links, {recursive: true});
  }
  console.log(`Bundled Chromium ${manifest.chromium_version} for ${manifest.platform}/${manifest.arch} (${relative}).`);
  return manifest;
}

module.exports = {ensureBrowser};
if (require.main === module) {
  try { ensureBrowser(process.argv[2] ? path.resolve(process.argv[2]) : undefined); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
