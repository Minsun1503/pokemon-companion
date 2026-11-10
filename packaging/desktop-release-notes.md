Install Pokémon Companion through your AI desktop client. Node, Electron, native desktop helpers, and all seven Pokémon are bundled. No terminal commands, extra components, GitHub login, model API key, or manual MCP configuration are required for Claude Desktop.

| Computer | Claude Desktop download | Desktop plugin payload |
| --- | --- | --- |
| Windows x64 | `pokemon-companion-0.2.1-claude-windows-x64.mcpb` | `pokemon-companion-0.2.1-plugin-windows-x64.zip` |
| macOS Apple Silicon | `pokemon-companion-0.2.1-claude-macos-arm64.mcpb` | `pokemon-companion-0.2.1-plugin-macos-arm64.zip` |
| macOS Intel | `pokemon-companion-0.2.1-claude-macos-x64.mcpb` | `pokemon-companion-0.2.1-plugin-macos-x64.zip` |
| Linux x64 | Official Claude Desktop loader unavailable | `pokemon-companion-0.2.1-plugin-linux-x64.zip` |

**Claude:** open your `.mcpb` in Claude Desktop, confirm Install, enable the extension, and give Claude a computer task. Claude starts the Pokémon automatically. Normal tool confirmations and OS permissions still apply. macOS automatically unpacks its included Electron runtime on first use, preserving its framework links.

**ChatGPT:** the plugin ZIPs contain native desktop-only manifests and the complete local MCP runtime. Public installation through ChatGPT's Plugins directory is **pending OpenAI local-MCP partner approval and plugin review**. These are payloads prepared for submission; opening or uploading a ZIP does not install it in ChatGPT. No ChatGPT approval or in-client installation is claimed. See [OpenAI's requirements](https://developers.openai.com/plugins/deploy/desktop-only).

The Windows compatibility MCPB and client-installer ZIP remain included. Talk is disabled; the connected AI client supplies the task loop. Click the Pokémon to switch characters or exit; Ctrl+Shift+P pauses/resumes controls.

Client packages are extracted and launched from their shipped configurations using only system tools on PATH. Windows/macOS checks use Anthropic's MCPB unpacker. Tests verify bundled Node, platform helpers, MCP tools, and real companion startup. They do not verify installation through Claude or ChatGPT's own UI. `SHA256SUMS.txt` contains download checksums.

Windows native controls are verified. macOS/Linux full desktop workflows remain experimental. Linux targets Ubuntu 24.04-compatible X11 desktops with user namespaces; Wayland is unsupported. Windows binaries are unsigned; macOS is ad-hoc signed without notarization. This is an unofficial Pokémon fan project; attribution and software licenses are included.
