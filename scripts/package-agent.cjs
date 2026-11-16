const fs = require('node:fs');
const path = require('node:path');

function addAgentLauncher(root, appRoot, platform) {
  fs.mkdirSync(path.join(appRoot, 'scripts'), {recursive: true});
  fs.copyFileSync(path.join(__dirname, 'harness.cjs'), path.join(appRoot, 'scripts/harness.cjs'));
  fs.copyFileSync(path.join(__dirname, '../docs/pokemon-agent.md'), path.join(root, 'AGENT-SETUP.md'));
  const prefix = path.relative(root, appRoot);
  if (platform === 'win32') {
    for (const name of ['agent-service.ps1', 'install-agent-autostart.ps1']) {
      fs.copyFileSync(path.join(__dirname, name), path.join(appRoot, 'scripts', name));
    }
    const location = prefix ? prefix + '\\' : '';
    fs.writeFileSync(path.join(root, 'Start Pokemon Agent.cmd'), `@echo off\r\n"%~dp0${location}runtime\\node.exe" "%~dp0${location}scripts\\harness.cjs" setup\r\nif errorlevel 1 pause\r\n`);
    fs.writeFileSync(path.join(root, 'Enable Pokemon Agent Autostart.cmd'), `@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0${location}scripts\\install-agent-autostart.ps1"\r\nif errorlevel 1 pause\r\n`);
  } else {
    const folder = prefix.replaceAll('\\', '/') || '.';
    fs.writeFileSync(path.join(root, 'Start Pokemon Agent.command'), `#!/bin/sh\nset -eu\nagent_root=$(CDPATH= cd -- "$(dirname -- "$0")/${folder}" && pwd)\nexport POKEMON_AGENT_DESKTOP="$agent_root/runtime/agent-desktop/agent-desktop"\nexec "$agent_root/runtime/node" "$agent_root/scripts/harness.cjs" setup\n`, {mode: 0o755});
  }
}
module.exports = {addAgentLauncher};
