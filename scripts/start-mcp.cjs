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
  return {root, backend, frontend, frontendEntry};
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
