# Install Pokémon Companion

Client packages include Node, Electron, all seven Pokémon, and native computer-control tools. Users need their AI desktop client and normal OS permissions. No additional developer tools, model API key, GitHub login, or manual MCP configuration are required.

## Claude Desktop on Windows or macOS

1. Open [Releases](https://github.com/Minsun1503/pokemon-companion/releases/latest) and download the `.mcpb` for your computer: Windows x64, macOS Intel x64, or macOS Apple Silicon arm64.
2. Open the file in Claude Desktop and confirm **Install**. If your system does not associate `.mcpb` with Claude, choose **Settings → Extensions → Advanced settings → Install Extension**, then select the file.
3. Enable Pokémon Companion. In a Claude chat, ask: **“Use Pikachu to help me with my computer. Inspect the app, perform my task, and verify the result.”**

Claude starts the Pokémon automatically when its tools are used. Its tool confirmations and macOS Accessibility/Screen Recording permissions still apply. You can uninstall from Claude's extension settings. macOS packages include an intact Electron runtime that is automatically unpacked into your user profile on first use; no separate installation is needed.

## ChatGPT Desktop

The `*-plugin-*.zip` downloads contain a native desktop-only plugin manifest, bundled stdio MCP server, Node, Electron, and platform desktop helpers. They are prepared for the local-MCP submission flow.

**Public one-click installation in ChatGPT is pending OpenAI approval.** OpenAI requires the submitting organization to be an approved local-MCP partner and reviews the plugin before publishing it in the Plugins directory. After approval, users install from that directory and use it in a local desktop conversation. Opening or uploading the ZIP in an ordinary ChatGPT conversation does not install a plugin. This project has not obtained that approval or verified installation in ChatGPT.

See [OpenAI's desktop-only distribution documentation](https://developers.openai.com/plugins/deploy/desktop-only).

## Linux

The Linux x64 plugin ZIP includes its desktop helper and runtimes for clients supporting local desktop plugins. Claude's official desktop extension installer is available for Windows and macOS; Linux is not advertised as Claude Desktop compatible. The included Linux helper targets Ubuntu 24.04-compatible systems. Generic input requires X11 and user namespaces; Wayland is unsupported. macOS/Linux desktop workflows remain experimental.

## Existing Windows Claude Code and Codex installers

The compatibility download `pokemon-companion-win32-x64.zip` includes **Install Claude Code.cmd** and **Install Codex.cmd**. Extract the full ZIP and run the installer for your already-installed client. Restart that client and open a new chat. Keep the extracted folder available for marketplace refreshes. These are optional compatibility paths; Claude Desktop users should use the `.mcpb` above.

The source marketplace remains `Minsun1503/pokemon-companion`. A GitHub marketplace installation downloads and verifies its Windows runtime on first connection. Use your client's plugin manager to uninstall.

## Pokémon controls

Left-click the Pokémon for **Switch** and **Exit**. Switch offers Pikachu, Riolu, Lucario, Clodsire, Bulbasaur, Charmander, and Squirtle. **Ctrl+Shift+P** pauses/resumes controls. Exit stops the companion and further computer actions; reconnect the extension to restart it. Talk is deferred and disabled. Give tasks in your AI client's chat.

The included `AGENT_GUIDE.md` describes native discovery, verification, recovery, and pause handling. Windows desktop Excel operations require Excel to be installed, just as controlling any other app requires that app.

## Build and verify releases from source

For developers with Node 22.12+ and npm on each target OS:

```text
npm run setup:ci
npm run check
npm run build
npm test
npm run package:desktop
npm run test:client-package
```

GitHub Actions builds Windows x64, macOS Intel/Apple Silicon, and Linux x64 packages using native runners. Tests extract the client package, resolve its shipped configuration, and start the actual MCP server and companion with only system tools on PATH. Windows/macOS tests use Anthropic's MCPB unpacker. This verifies bundled dependencies and startup, not installation through either AI client's UI. Linux tests run under an X11 test desktop.

`npm run package:windows` also builds the Windows compatibility assets. Builders use fresh staging folders and preserve development dependencies. They exclude source `.env` files, Git history, and saved chat histories. Existing output directories must be moved aside before rebuilding.

Windows binaries are unsigned. macOS binaries are ad-hoc signed without Apple notarization. See [THIRD_PARTY.md](THIRD_PARTY.md) for included software and asset licenses.
