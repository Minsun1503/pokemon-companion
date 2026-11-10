Download the ZIP for your computer, extract the entire folder, and open the included app. Node.js and Electron are bundled; no separate Node install or GitHub login is required.

| Download | Included app |
| --- | --- |
| Windows x64 | `Pokemon Companion.exe` |
| macOS Apple Silicon (arm64) | `Pokemon Companion.app` |
| macOS Intel (x64) | `Pokemon Companion.app` |
| Linux x64 | `Pokemon Companion` executable |

Click the Pokémon to switch among seven companions or exit. Talk is disabled for now. For AI computer tasks, connect Pokémon MCP to your local AI client using the instructions in `README.txt` inside the ZIP. Opening the standalone companion alone does not start an AI task loop.

Every ZIP is tested after extraction to a different path: the native launcher opens and closes the real Electron companion, the bundled Node runtime starts, and the MCP server connects and exposes its tools. `SHA256SUMS.txt` contains download checksums.

The existing Windows MCPB extension and client-installer ZIP are also included for Claude Desktop, Claude Code, and Codex installation.

Windows native computer control is verified. macOS/Linux desktop workflows remain experimental; their generic input needs the usual OS permissions, and window automation needs a separately installed agent-desktop 2.6 bridge. Linux requires an X11 desktop and user namespaces. These builds are unsigned on Windows and ad-hoc signed on macOS, without Apple notarization.

This is an unofficial Pokémon fan project. Asset attribution and original software licenses are included.
