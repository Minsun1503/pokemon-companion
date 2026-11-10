// Client-owned local MCP entry point. Any runtime preparation stays off protocol stdout.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const root = __dirname;
const profile = process.env.POKEMON_USER_DATA_DIR || (process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'), 'pokemon-mcp')
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/pokemon-mcp')
  : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'pokemon-mcp'));
fs.mkdirSync(profile, {recursive: true});
process.env.POKEMON_USER_DATA_DIR = profile;
process.env.POKEMON_FRONTEND_DIR = path.join(root, 'frontend');
delete process.env.ELECTRON_RUN_AS_NODE;

try {
  if (process.platform === 'darwin') {
    // MCPB extractors do not consistently preserve framework symlinks. Embed the intact
    // Electron ZIP, and unpack it with macOS's built-in tool on first use.
    const metadata = JSON.parse(fs.readFileSync(path.join(root, 'runtime/electron.json'), 'utf8'));
    const cacheRoot = path.join(profile, 'runtimes');
    const cache = path.join(cacheRoot, `electron-${metadata.version}-${process.arch}-${metadata.sha256.slice(0, 12)}`);
    const executable = path.join(cache, metadata.executable);
    const marker = path.join(cache, '.ready');
    const framework = 'Electron.app/Contents/Frameworks/Electron Framework.framework/Electron Framework';
    const ready = () => fs.existsSync(executable) && fs.existsSync(path.join(cache, framework)) && fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === metadata.sha256;
    if (!ready()) {
      const archive = path.join(root, 'runtime/electron.zip');
      if (crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== metadata.sha256) throw new Error('Bundled Electron archive checksum mismatch.');
      fs.mkdirSync(cacheRoot, {recursive: true});
      if (fs.existsSync(cache)) {
        if (path.dirname(fs.realpathSync(cache)) !== fs.realpathSync(cacheRoot)) throw new Error('Invalid runtime cache directory');
        fs.rmSync(cache, {recursive: true});
      }
      const stage = fs.mkdtempSync(path.join(cacheRoot, '.extract-'));
      try {
        execFileSync('/usr/bin/ditto', ['-x', '-k', archive, stage], {stdio: 'pipe'});
        if (!fs.existsSync(path.join(stage, metadata.executable)) || !fs.existsSync(path.join(stage, framework))) throw new Error('Bundled Electron framework was not extracted completely.');
        fs.writeFileSync(path.join(stage, '.ready'), metadata.sha256);
        try { fs.renameSync(stage, cache); }
        catch (error) { if (!ready()) throw error; }
      } finally {
        if (fs.existsSync(stage)) {
          if (path.dirname(fs.realpathSync(stage)) !== fs.realpathSync(cacheRoot)) throw new Error('Invalid runtime scratch directory');
          fs.rmSync(stage, {recursive: true});
        }
      }
    }
    process.env.POKEMON_ELECTRON_BINARY = executable;
  }
  void import(pathToFileURL(path.join(root, 'backend/dist/main.js')).href).catch(error => {console.error(error.message); process.exitCode = 1;});
} catch (error) {
  console.error('Pokémon Companion could not prepare its bundled runtime:', error.message);
  process.exitCode = 1;
}
