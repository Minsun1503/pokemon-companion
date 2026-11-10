# Install Pokémon Companion

This Windows x64 package includes all seven Pokémon, Node, Electron, and native computer-control dependencies. No npm commands, model API key, or JSON edits are needed to use computer control with your AI client.

## Claude Desktop chat

1. Download the [Claude Desktop extension](https://github.com/Minsun1503/pokemon-companion/releases/latest/download/pokemon-companion-win32-x64.mcpb), open it, and confirm **Install** in Claude Desktop. If Windows does not associate the file with Claude, open Claude **Settings → Extensions → Advanced settings → Install Extension** and select the file.
2. Enable Pokémon Companion, open a chat, and ask: **“Use Pikachu to help me with my computer. Prefer the Windows API and verify the result.”**

Claude starts the companion automatically. You can remove it in Settings → Extensions. Claude Desktop still asks you to allow computer-control tools according to your tool permissions.

## Claude Code or its desktop Code tab

Download and extract the [portable ZIP](https://github.com/Minsun1503/pokemon-companion/releases/latest/download/pokemon-companion-win32-x64.zip) completely, then double-click **Install Claude Code.cmd**. Restart Claude Code and open a new chat. Claude Code must already be installed.

Alternatively, send these as two separate prompts:

```text
/plugin marketplace add Minsun1503/pokemon-companion
```

```text
/plugin install pokemon-companion@pokemon-companion
```

## Codex CLI or desktop

Download and extract the [portable ZIP](https://github.com/Minsun1503/pokemon-companion/releases/latest/download/pokemon-companion-win32-x64.zip) completely, then double-click **Install Codex.cmd**. Restart Codex and open a new chat. Codex must already be installed.

The installer runs the same two steps Ponytail uses:

```powershell
codex plugin marketplace add Minsun1503/pokemon-companion
codex plugin add pokemon-companion@pokemon-companion
```

The GitHub-installed plugin downloads and verifies its Windows runtime on first connection. Allow a few minutes for that first download. ZIP installations work locally; keep the extracted folder available for marketplace refreshes. Uninstall with your client's plugin manager.

## Pokémon controls

Left-click your Pokémon for **Switch**, **Talk**, and **Exit**. Switch includes Pikachu, Riolu, Lucario, Clodsire, Bulbasaur, Charmander, and Squirtle. Ctrl+Shift+P pauses/resumes computer control. Exit stops the companion and computer actions; reconnect the plugin to restart it.

Send computer tasks in the AI client's chat. The Pokémon Talk panel currently uses a separate configured character-chat provider; it does not forward to that AI chat automatically.

The portable package includes `AGENT_GUIDE.md`, matched to its package and response-contract versions. It explains discovery, verification, safe recovery, and pause handling. The read-only `desktop` status tool reports backend readiness and supported actions.

## Build a release from source

For developers on x64 Windows with Node 22.12+:

```powershell
npm run setup
npm run package:windows
npm run test:package
```

The `release` folder contains the `.mcpb`, portable `.zip`, and SHA-256 checksums. The package builder installs production dependencies in a fresh release staging folder and never removes development dependencies. No source `.env` files, Git history, or chat histories are included. Move an existing release directory aside before rebuilding.

The marketplaces also work from this source checkout. GitHub marketplace installation requires the matching version's release assets. Both original source projects and their MIT licenses are included; see [THIRD_PARTY.md](THIRD_PARTY.md).

Installation follows [Ponytail's plugin approach](https://github.com/DietrichGebert/ponytail/blob/main/INSTALL.md), [Claude's MCP bundle format](https://github.com/anthropics/mcpb), and [OpenAI's local plugin marketplace documentation](https://developers.openai.com/plugins/build/plugins).
