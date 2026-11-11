const fs = require('node:fs');
const path = require('node:path');

function write(root, relative, data) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
function addClientMetadata(root, appRoot, platform, version, serverEntry = 'backend/dist/main.js') {
  const prefix = path.relative(root, appRoot).replaceAll('\\', '/');
  const relative = file => prefix ? prefix + '/' + file : file;
  const config = variable => ({
    command: `${variable}/${relative(platform === 'win32' ? 'runtime/node.exe' : 'runtime/node')}`,
    args: [`${variable}/${relative(serverEntry)}`],
    env: {
      MCP_TRANSPORT: 'stdio',
      POKEMON_FRONTEND_DIR: `${variable}/${relative('frontend')}`,
      ...(platform === 'win32' ? {} : {POKEMON_AGENT_DESKTOP: `${variable}/${relative('runtime/agent-desktop/agent-desktop')}`}),
    },
  });
  const identity = {name: 'pokemon-companion', version, description: 'Nine animated companions for local AI computer control.', author: {name: 'Minsun1503', url: 'https://github.com/Minsun1503'}};
  const interface = {displayName: 'Pokémon Companion', shortDescription: 'Use Pokémon to control your computer', developerName: 'Minsun1503', category: 'Productivity', capabilities: ['Read', 'Write'], logo: './icon.png'};
  write(root, 'manifest.json', {
    manifest_version: '0.3', ...identity, display_name: 'Pokémon Companion', icon: 'icon.png', license: 'MIT',
    long_description: 'Open this MCPB in Claude Desktop and confirm installation. Node, Electron, Pokémon assets, and native desktop tools are bundled. No terminal commands, model API keys, GitHub login, or manual MCP configuration are required. Give computer tasks to Claude; Talk is disabled. macOS requires the usual Accessibility and Screen Recording permissions.',
    server: {type: 'binary', entry_point: relative(platform === 'win32' ? 'runtime/node.exe' : 'runtime/node'), mcp_config: config('${__dirname}')},
    tools: ['desktop', 'computer', 'pokemon', 'windows', ...(platform === 'win32' ? ['course', 'excel'] : [])].map(name => ({name, description: {desktop: 'Check desktop readiness and pause state.', computer: 'Native keyboard, pointer and screenshot actions.', pokemon: 'Select companions and show task progress.', windows: 'Read and operate native app controls.', course: 'Read and navigate course pages.', excel: 'Read and update desktop Excel workbooks.'}[name]})),
    prompts_generated: true, compatibility: {platforms: [platform]},
  });
  write(root, 'plugin.json', {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', ...identity, license: 'MIT',
    homepage: 'https://github.com/Minsun1503/pokemon-companion',
    extensions: {'com.openai': {requires_local_executor: true, interface}},
  });
  write(root, 'mcp.json', {$schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: {'pokemon-companion': {type: 'stdio', ...config('${PLUGIN_ROOT}'), cwd: '${PLUGIN_ROOT}'}}});
  write(root, '.claude-plugin/plugin.json', {...identity, mcpServers: {'pokemon-companion': config('${CLAUDE_PLUGIN_ROOT}')}});
  write(root, '.codex-plugin/plugin.json', {...identity, requires_local_executor: true, interface});
  write(root, '.agents/plugins/marketplace.json', {name: 'pokemon-companion', interface: {displayName: 'Pokémon Companion'}, plugins: [{name: identity.name, source: {source: 'local', path: './'}, policy: {installation: 'AVAILABLE', authentication: 'ON_INSTALL'}, category: 'Productivity'}]});
  fs.copyFileSync(path.join(appRoot, 'frontend/assets/icon.png'), path.join(root, 'icon.png'));
  fs.writeFileSync(path.join(root, 'CLIENT-INSTALL.txt'), `Pokemon Companion ${version}\n\nCLAUDE DESKTOP (Windows/macOS)\nOpen the .mcpb download in Claude Desktop. Confirm Install and enable the extension. Then ask Claude to use Pokemon Companion. Everything needed by this extension is bundled; no developer tools or manual MCP configuration are needed. Normal desktop permission prompts still apply.\n\nCHATGPT DESKTOP\nThe plugin ZIP contains plugin.json, mcp.json, and the complete local server and runtimes. It is prepared for the desktop-only local-MCP submission flow. Public distribution through the ChatGPT Plugins directory requires OpenAI approval for your submitting organization, followed by plugin review. After approval, users install it from that directory and use it in a local desktop conversation. This package has not yet been approved or installed in ChatGPT; opening a ZIP in an ordinary cloud conversation does not install a desktop plugin.\nSee https://developers.openai.com/plugins/deploy/desktop-only\n\nLINUX\nThe plugin ZIP includes its runtime and desktop bridge for clients that support local desktop plugins. Claude's official desktop extension loader is provided on Windows and macOS; Linux is not advertised as Claude Desktop compatible.\n`);
}
module.exports = {addClientMetadata};
