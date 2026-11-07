# Pokémon Computer Companion

An AI controls your computer through MCP while an animated Pokémon appears to do the work on your desktop. Claude, Codex, or another MCP client is the brain. The local computer-use backend performs the actions, and the Electron companion shows movement, typing, thinking, speech, and celebrations.

All seven characters from the pet repository are included: **Pikachu, Riolu, Lucario, Clodsire, Bulbasaur, Charmander, and Squirtle**. Pikachu is the default. Change the character from its team panel, the tray menu, or the `pokemon` tool.

## Easy installation

Windows users can download the **[Claude Desktop extension](https://github.com/Minsun1503/pokemon-companion/releases/latest/download/pokemon-companion-win32-x64.mcpb)** and open it to install, or extract the **[portable ZIP](https://github.com/Minsun1503/pokemon-companion/releases/latest/download/pokemon-companion-win32-x64.zip)** and double-click **Install Claude Code.cmd** or **Install Codex.cmd**. The package bundles Node, Electron, native dependencies, and all seven Pokémon. See [installation steps](INSTALL.md).

Claude Code and Codex also support the same two-command installation style as Ponytail, using **`Minsun1503/pokemon-companion`** as the marketplace. The plugin downloads its Windows runtime on the first connection. Developers can build release files with `npm run package:windows`.

## Original repositories

This project includes the modified source of **[Pokemon-pets](https://github.com/DEV-asdf-516/Pokemon-pets)** in `frontend/` and **[computer-use-mcp](https://github.com/domdomegg/computer-use-mcp)** in `backend/`. Both original MIT licenses are retained. See [upstream authors and exact base commits](THIRD_PARTY.md).

## Run locally

Requires Node.js **22.12 or newer**, npm, and an unlocked graphical desktop. Run the commands below from the `pokemon-companion` folder, which contains the `frontend` and `backend` repositories, shared scripts, and MCP configuration.

```powershell
npm run setup
npm run build
npm run demo
```

The demo opens the companion and shows working, thinking, and completion animations without sending computer input. Left-click the pet to open its action menu. Ctrl+C in the demo terminal closes the demo and companion.

## Connect Claude or Codex

```powershell
npm run config
```

This generates configuration using the actual Node executable and checkout paths:

- `config/claude-desktop.json`: merge its `mcpServers` entry into your Claude Desktop MCP configuration, then restart Claude Desktop.
- `config/codex.toml`: add its server table to your Codex `config.toml`, then reconnect the MCP server. See [official Codex MCP configuration](https://developers.openai.com/codex/mcp/).

Use a local MCP client on the same computer as the companion. A cloud-only client cannot manipulate this desktop without a local connection. Computer control uses the connected AI client's model. The companion's separate Talk feature uses its configured AI provider.

Try: **“Use Pikachu to help me with my computer. Announce the task, inspect the screen, perform the actions, and tell me when you’ve verified the result.”**

## Tools

On Windows, **`windows` is the preferred tool**. It uses Win32 to list/activate windows and Windows UI Automation to read named controls and invoke their supported actions. Its results are compact text, with no screenshot images. The worker starts once and is reused for later requests.

Use `get_windows` to choose a `window_id`, then `get_ui` to inspect that window. Narrow `query` or `control_type` (such as `Button`, `Edit`, or `TabItem`) to return only relevant controls. Results default to 60 elements and 6,000 characters; lower `max_elements`/`max_chars` when possible. `truncated` indicates that you should narrow the query or increase the budget. For actions, pass the returned `snapshot` and `element_id`:

```json
{"action":"get_ui","window_id":"12345","query":"Search","control_type":"Edit","max_chars":2000}
{"action":"set_value","snapshot":"<returned snapshot>","element_id":1,"text":"Daft Punk"}
```

Supported control actions include `invoke`, `set_value`, `select`, `toggle`, `expand`, `collapse`, `scroll`, `focus`, and `read_text`. Only use actions listed for the returned control. Re-read `get_ui` after changes to verify the result. IDs belong to their snapshot, expire after two minutes, and are never rebound to a different control. Password controls are omitted.

`computer` retains native mouse/keyboard input, cursor actions, and screenshot capture. Prefer keyboard shortcuts when UI Automation lacks a pattern, and screenshots when the task requires visual information (for example, canvas content). The tool descriptions and `pokemon-work` prompt specify this order: **Windows APIs → keyboard shortcuts → screenshots**. Both tools update the Pokémon before and after actions. Screenshots briefly hide the companion.

`pokemon` controls presentation:

| Action | Inputs | Behavior |
| --- | --- | --- |
| `status` | none | Current character, activity, task, action count, visibility, and user pause state |
| `select` | `pet` | Switch among all seven characters without restarting |
| `task` | `message` | Announce a task and begin working animation |
| `think` | optional `message` | Thinking animation and bubble |
| `say` | `message` | Short progress bubble |
| `done` | optional `message` | Finish the task and celebrate |
| `error` | `message` | Show that the task needs help |
| `show` / `hide` | none | Change companion visibility |

The `pokemon-work` MCP prompt helps the AI use these tools together. The server does not itself plan a task or infer when a task is finished; the AI calls `done` after verifying the actual result.

## Desktop controls

- Left-click the Pokémon to open three action icons: **Switch**, **Talk**, and **Exit**.
- **Switch** opens all seven Pokémon; selecting one changes the companion immediately.
- **Talk** opens a conversation with the selected Pokémon. Enter sends a message; Shift+Enter adds a line. Each Pokémon keeps its own conversation history.
- **Exit** closes the companion and stops further computer actions.
- Click the Pokémon again, use the Close button, or press Escape to close the menu. Escape returns from Switch/Talk to the action menu first.
- Use **Ctrl+Shift+P** or the tray menu to pause/resume computer control. The AI cannot resume a user pause. A pause prevents the next input action; an input already being executed may finish.
- Use the tray’s **Summon at cursor** to reposition the Pokémon.
- Quit the companion to stop further computer actions. Restart the MCP connection to restore it.

The overlay stays above other windows and follows action targets with an offset. Clicks pass through during an individual computer action; the menu is available between actions. Opening it during a task pauses further computer control until you resume. Screenshots and coordinates use the computer backend’s image space. This retains the backend’s existing primary-display capture behavior; it does not add full multi-monitor capture.

Talk defaults to Ollama at `http://localhost:11434` with model `qwen3:8b`. Start Ollama with that model available, or configure OpenAI, Anthropic, or Gemini in `frontend/config/setting.json`. A setting file at `%APPDATA%/pokemon-mcp/setting.json` takes precedence. Cloud providers use their configured API key environment variable; `.env` files in the frontend repository or app data folder are also supported. If the provider is offline, Talk shows an error and retains your message for retry. Talk does not automatically forward messages to an existing AI chat; give computer-control tasks to your connected MCP client.

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `POKEMON_PET` | `pikachu` | Initial character |
| `POKEMON_FRONTEND_DIR` | adjacent `frontend` | Location of the built frontend |
| `POKEMON_UI` | enabled | Set `off` only for explicitly headless use |
| `MCP_TRANSPORT` | `stdio` | Optional `http` transport on localhost `/mcp` |
| `PORT` | `3000` | Local HTTP MCP port |

Stdio is recommended. HTTP binds only to `127.0.0.1`; it retains the original server’s lack of authentication. The separate companion bridge uses a random loopback port and a per-process authentication token. Do not expose the HTTP endpoint remotely.

## Checks

```powershell
npm run build
npm run check
npm test
npm run smoke
npm run test:input
npm run test:windows
```

The smoke test uses a real MCP SDK client, opens the real companion, selects all seven pets, captures a desktop screenshot, checks cursor output, and exercises task completion and visibility. It sends no clicks or keyboard input. `test:input` opens a disposable test window and verifies real clicks, Vietnamese text input, and keyboard shortcuts. `test:windows` uses a disposable accessible window to verify API field entry and button invocation, bounded text output, stale-id rejection, and zero screenshot images. Runtime tests cover serialized actions, user pauses, queued cancellation, and screenshot restoration on errors. Chat tests use an isolated local mock provider to verify requests, separate saved conversations, and failure handling.

## Structure

- `backend/src/pokemon`: companion lifecycle and serialized action feedback.
- `backend/src/windows`: persistent Win32/UI Automation worker and bounded text responses.
- `backend/src/tools`: computer and Pokémon MCP tools plus the work prompt.
- `frontend/src/main/companion`: dedicated Electron companion mode and authenticated bridge.
- `frontend/src/renderer/companion.*`: desktop overlay, animations, team picker, and activity panel.
- `frontend/pets`: original sprite packs. The original LLM pet-chat mode still launches with `npm start` inside that repository.
- `scripts`: shared setup, build, demo, and verification commands.
- `config`: generated MCP client configuration for this project location.

This is a local development integration, not a published npm package or standalone installer. Windows is the verified platform. macOS/Linux paths are implemented but require platform testing and their usual desktop accessibility/capture permissions.

Pokémon names and assets belong to Nintendo / Creatures Inc. / GAME FREAK. This is an unofficial fan project. Original repositories retain their MIT licenses.
