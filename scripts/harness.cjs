const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'backend/dist/harness/main.js');
if (!fs.existsSync(entry)) throw new Error('Build the active checkout with npm run build first.');
process.chdir(root);
const running = import(pathToFileURL(entry).href).then(module => module.main(process.argv[2] || 'setup', root, process.argv.slice(3))).catch(error => {console.error(error.message); process.exitCode = 1;});
const ownerPid = Number(process.env.POKEMON_AGENT_PARENT_PID);
if (Number.isSafeInteger(ownerPid) && ownerPid > 0 && ownerPid !== process.pid) {
  const watcher = setInterval(() => {
    try {process.kill(ownerPid, 0);} catch (error) {
      if (error.code !== 'ESRCH') return;
      clearInterval(watcher);
      void running.then(() => {
        process.emit('SIGTERM');
        setTimeout(() => process.exit(1), 20000).unref();
      });
    }
  }, 1000);
  watcher.unref();
}
