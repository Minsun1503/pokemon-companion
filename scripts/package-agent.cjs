const fs = require('node:fs');
const path = require('node:path');

function addAgentLauncher(root, appRoot, platform, options = {}) {
  fs.mkdirSync(path.join(appRoot, 'scripts'), {recursive: true});
  fs.copyFileSync(path.join(__dirname, 'harness.cjs'), path.join(appRoot, 'scripts/harness.cjs'));
  fs.copyFileSync(path.join(__dirname, '../docs/pokemon-agent.md'), path.join(root, 'AGENT-SETUP.md'));
  fs.mkdirSync(path.join(root, 'docs'), {recursive: true});
  for (const name of ['pokemon-agent.md', 'agent-team-sources.md']) {
    fs.copyFileSync(path.join(__dirname, '../docs', name), path.join(root, 'docs', name));
  }
  fs.writeFileSync(path.join(root, 'AGENT-SETUP.md'), fs.readFileSync(path.join(root, 'AGENT-SETUP.md'), 'utf8').replace(/\]\((agent-team-sources\.md|telegram-personal-pc-setup\.vi\.md)\)/g, '](docs/$1)'));
  fs.copyFileSync(path.join(__dirname, '../TELEGRAM-SETUP-VI.md'), path.join(root, 'TELEGRAM-SETUP-VI.md'));
  fs.copyFileSync(path.join(__dirname, '../docs/group-welcome.vi.md'), path.join(root, 'GROUP-WELCOME.vi.md'));
  if (options.deepSeekOnly) {
    if (platform !== 'win32') throw new Error('The DeepSeek Telegram installer targets Windows.');
    fs.copyFileSync(path.join(__dirname, '../docs/agent-install.vi.md'), path.join(root, 'AGENT-SETUP.md'));
    fs.copyFileSync(path.join(__dirname, '../packaging/telegram-agent-instructions.md'), path.join(root, 'AGENTS.md'));
    fs.writeFileSync(path.join(appRoot, 'agent-profile.json'), JSON.stringify({id: 'deepseek-telegram', version: 1}, null, 2) + '\n');
    fs.writeFileSync(path.join(root, 'START-HERE.md'), '# Pokémon Telegram — bắt đầu ở đây\n\nĐưa cả thư mục này cho agent của bạn và nhắn: “Đọc AGENT-SETUP.md, hỏi tôi tên bot và các lựa chọn cần thiết, đưa bản xác nhận rồi setup giúp tôi. Chỉ dùng một API DeepSeek.”\n\nAgent đọc [AGENT-SETUP.md](AGENT-SETUP.md); người tự cài đọc [TELEGRAM-SETUP-VI.md](TELEGRAM-SETUP-VI.md). Mẫu tin ghim: [GROUP-WELCOME.vi.md](GROUP-WELCOME.vi.md).\n\nGiải nén đầy đủ, giữ nguyên các thư mục đi kèm. Chạy Start Pokemon Agent.cmd: wizard trên cửa sổ dòng lệnh hỏi API key DeepSeek và bot token. Sau đó nhắn riêng cho bot để nhận mã ghép cặp và duyệt mã trên máy. Không cần cài Node/npm, không cần nhóm. Gói không chứa key/token thật.\n');
  }
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
