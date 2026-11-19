const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

function configuration(root = path.resolve(__dirname, '..')) {
  const backend = path.join(root, 'backend/dist/main.js');
  const frontend = path.join(root, 'frontend');
  const frontendEntry = path.join(frontend, 'build/main/companion/index.js');
  for (const file of [backend, frontendEntry, path.join(frontend, 'package.json')]) {
    if (!fs.existsSync(file)) throw new Error(`Missing ${file}. Run npm run setup and npm run build in ${root}.`);
  }
  warnIfStale(path.join(root, 'backend/src'), backend);
  warnIfStale(path.join(frontend, 'src'), frontendEntry);
  return {root, backend, frontend, frontendEntry};
}

function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs);
  }
  return newest;
}

function warnIfStale(sourceDir, builtFile) {
  try {
    if (newestMtime(sourceDir) > fs.statSync(builtFile).mtimeMs) {
      process.stderr.write(`Warning: ${path.relative(path.resolve(__dirname, '..'), sourceDir)} is newer than its build. Run npm run build (or npm run update).\n`);
    }
  } catch {}
}

async function launch(root) {
  const config = configuration(root);
  // Keep the backend and UI in one checkout regardless of caller cwd or environment.
  process.chdir(config.root);
  process.env.POKEMON_FRONTEND_DIR = config.frontend;
  process.stderr.write(`Pokémon MCP checkout: ${config.root}\n`);
  await import(pathToFileURL(config.backend).href);
}

module.exports = {configuration, launch};
if (require.main === module) {
  Promise.resolve().then(() => {
    if (process.argv.includes('--check')) console.log(JSON.stringify(configuration(), null, 2));
    else return launch();
  }).catch(error => {console.error(error.message); process.exitCode = 1;});
}
