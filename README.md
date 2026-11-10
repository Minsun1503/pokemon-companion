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

`desktop` with `{"action":"status"}` checks backend readiness, supported native actions, platform limits, and pause state. It sends no input, works while paused, and is bounded to five seconds including queue time. Readiness does not establish permission to control every app.

On Windows, **`windows` is the preferred tool**. It uses Win32 to list/activate windows and Windows UI Automation to read named controls and invoke their supported actions. Its results are compact text, with no screenshot images. The worker starts once and is reused for later requests.

Discovery results report `complete` and `truncated`. Windows errors include `error_details` with an error code and delivery/retry evidence; retry a failed operation only when its evidence permits it. In a partial batch, this applies only to the stopped step, and earlier steps remain applied. See the [Windows discovery and error contract](docs/windows-api.md).

See the [agent-desktop comparison and improvement roadmap](docs/agent-desktop-comparison.md) for the architecture review and implemented reliability changes.

Use `get_windows` to choose a `window_id`, then `get_ui` to inspect that window. Narrow `query` or `control_type` (such as `Button`, `Edit`, or `TabItem`) to return only relevant controls. Results default to 60 elements and 6,000 characters; lower `max_elements`/`max_chars` when possible. `truncated` indicates that you should narrow the query or increase the budget. For actions, pass the returned `snapshot` and `element_id`:

Preserve discovery's `window_ref` with `window_id` on later reads and activation. Batch window references propagate it automatically. `get_ui` with `view:"skeleton"` lists named containers without field-value previews. Select a targetable container and supply its `root_snapshot` and `root_element_id` to read its subtree. Partial or ambiguous root identities cannot be used for actions.

`max_chars` must be at most 16,000. Field previews are limited to 160 characters and carry `value_clipped: true` when shortened, even if the tree has `truncated: false`; use `read_text` for the full field text. If only title-bar controls appear, call `activate` on the window and read again: Electron/Chromium may expose their controls only after activation. After navigation or `invoke`, the first read may still show the previous view; re-read once before concluding.

`matched` is a lower bound when `truncated` is true. Use `wait_for` to poll controls or exact values with a bounded timeout (default 5 seconds, maximum 15 seconds). After an interrupted wait, call `get_ui` again for fresh snapshots. Use `launch` to start an executable name/path or HTTP(S) URL and wait for a window; URLs require a window-title/process `query`, and command shells, script hosts and arguments are unsupported. Interrupted Windows ASCII typing reports submitted characters; input methods may transform them, so inspect the field before continuing instead of retyping from the start.

`wait_condition` supports `present`, `absent`, `enabled`, `disabled`, `selected`, and `unselected`. An absence wait requires `snapshot` and `element_id` from an earlier complete whole-window observation of a unique control; its query must equal the captured stable name or automation ID. It succeeds only after complete zero-match coverage within the same observed window. See the [Windows contract](docs/windows-api.md) for examples and limits.

```json
{"action":"get_ui","window_id":"12345","query":"Search","control_type":"Edit","max_chars":2000}
{"action":"set_value","snapshot":"<returned snapshot>","element_id":1,"text":"Daft Punk"}
```

Supported control actions include `invoke`, `set_value`, `select`, `toggle`, `expand`, `collapse`, `scroll`, `focus`, and `read_text`. Only use actions listed for the returned control. Re-read `get_ui` after changes to verify the result. IDs belong to their snapshot, expire after two minutes, and are never rebound to a different control. Password controls are omitted.

**Batch is the default Windows mode.** Supply `steps` and omit the top-level `action`, or set `action:"batch"` explicitly. The MCP runs 1-16 steps sequentially and returns just the final result and completed count. Use an explicit atomic action when the next step needs judgment. For example, finding a window, filling a field, pressing a button, and checking the field takes one MCP call:

```json
{
  "max_chars": 2000,
  "steps": [
    {"action":"get_windows","query":"Pokémon Input Test"},
    {"action":"get_ui","window_step":0,"query":"Test note","control_type":"Edit"},
    {"action":"set_value","target_step":1,"text":"Hello from Pikachu!"},
    {"action":"get_ui","window_step":0,"query":"Verify input","control_type":"Button"},
    {"action":"invoke","target_step":3},
    {"action":"get_ui","window_step":0,"query":"Test note","control_type":"Edit","expect_value":"Hello from Pikachu!"}
  ]
}
```

`window_step` and `target_step` are zero-based references to earlier results in the same batch. A window reference accepts a unique, untruncated `get_windows` result or the window from `get_ui`. A control reference requires exactly one untruncated `get_ui` match supporting the action. Explicit `window_id` or `snapshot`/`element_id` can also be used instead of references. `expect_value` on `get_ui` checks one control's exact value (up to 160 characters) before continuing. It verifies the field, not any later application side effect.

The whole sequence excludes input from other MCP clients, checks user pauses and cancellation before each step, and stops on an error or ambiguous target. Failure output reports `completed`, `stopped_step`, `failed_step_started`, and bounded diagnostics. Earlier successful steps remain applied; a failed native step may also have applied its action. Inputs are never retried automatically. Inspect the failure before continuing. Top-level `max_chars` bounds the entire response, while each step has its own discovery budget; narrow filters if results are truncated. Use atomic calls when the next step requires the AI to interpret new information. Batching reduces model round trips; Windows API calls still execute individually on the computer.

`computer` retains native mouse/keyboard input, cursor actions, and screenshot capture. Prefer keyboard shortcuts when UI Automation lacks a pattern, and screenshots when the task requires visual information (for example, canvas content). The tool descriptions and `pokemon-work` prompt specify this order: **Windows APIs → keyboard shortcuts → screenshots**. Both tools update the Pokémon before and after actions. Screenshots briefly hide the companion.

Handled failures from `computer`, Course, and Excel include `contract_version:1` and delivery/retry evidence. Generic input success reports `verified:false`: it confirms dispatch, and you still need to inspect the result. Interrupted ASCII typing exposes `error_details.progress` with submitted/total character counts; later focus loss does not permit replaying the full string. Key and drag cleanup attempt to release held inputs even after a partial failure.

Use Windows `focus`, `invoke`, `set_value` and batch first. When no control is exposed or no UIA pattern fits, use a known direct shortcut: `ctrl+l` for the browser address bar, `ctrl+1..8` for an indexed browser tab (`ctrl+9` selects the last tab), `escape` to dismiss, or `ctrl+,` for settings where supported. On Windows, pass `window_id` for the foreground guard and verify the result immediately. Never use `tab`, `ctrl+tab`, or `alt+tab` as blind navigation. Windows `computer key` and `type` accept optional `window_id` to reject input when another window is foreground. An owned dialog also matches its root owner's ID. The guard never activates a window, and focus can still change between the check and input. Calls without `window_id` retain their existing behavior.

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

### Course navigation and reading

The Windows-only **`course`** tool combines repeated course steps into one call. `open_lesson` opens one named lesson control, waits for changed text containing a unique expected marker, and returns a text page. `search_courses` fills the exact course search field, verifies its value, and waits for the expected result. `read_lesson` reads long lessons in versioned pages. `check_completion` returns evidence for a specific completion message.

Start with `windows get_windows/get_ui` to identify the window and exact accessible names. These helpers use native Windows APIs, require visible controls, respect pauses, and never replay inputs automatically. They do not answer quizzes or automatically press Finish. Accessible text reading does not inspect attached files, images, or videos. See [API examples, pagination, and limits](docs/course-api.md). Reconnect the MCP server after building to expose the new tool in an existing client.

### Desktop Excel operations

The Windows-only **`excel`** tool provides `inspect_workbook`, `read_range`, `write_range`, `find_cells`, `select_range`, and `save_workbook`. It attaches to Excel's native object model through a specific workbook window, so bulk range access works even when another workbook is active. Reads use versioned pages; writes keep strings literal by default, support an explicit formula mode, and verify the stored contents. Overwriting requires a fresh range version. Saving is a separate, explicit action.

Use `windows get_windows` to choose Excel, then `excel inspect_workbook` for exact workbook/sheet names. See [Excel API examples and limits](docs/excel-api.md). Requires installed Windows desktop Excel with a normal workbook window; Protected View and Excel Online are unsupported. Reconnect the MCP server after building to expose this tool.

## Windows benchmark

The [verified benchmark report](benchmarks/results/windows-main-2026-11-09-visual.md) compares six atomic calls with one batch on a normal window and controls behind 35 anonymous groups, with 30 warm runs per mode per fixture. Batch used **83.3% fewer MCP calls** and about **64.7% less result text**; local median execution times were close. Every field and button action was independently verified. No AI inference or token/dollar savings were measured.

![Windows benchmark: latency distributions, MCP calls and result text for atomic and batch workflows.](benchmarks/results/windows-main-2026-11-09-visual.png)

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
| `POKEMON_USER_DATA_DIR` | OS app-data profile | Optional separate companion settings, chat and cache folder |
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
npm run test:course
npm run test:excel
npm run test:windows:contract
npm run test:windows:identity
npm run test:windows:coordination
npm run test:package
```

The smoke test uses a real MCP SDK client, opens the real companion, selects all seven pets, captures a desktop screenshot, checks cursor output, and exercises task completion and visibility. It sends no clicks or keyboard input. `test:input` opens a disposable test window and verifies real clicks, Vietnamese text input, and keyboard shortcuts. `test:windows` verifies six API steps in one MCP call, field entry and button invocation, atomic compatibility, bounded text output, stale-id rejection, and zero screenshot images. Batch tests cover ambiguity, unsupported actions, partial failures, value checks, pauses/cancellation between steps, and isolation from other clients. Runtime tests cover serialized actions, user pauses, queued cancellation, and screenshot restoration on errors. Chat tests use an isolated local mock provider to verify requests, separate saved conversations, and failure handling.

Run `npm run benchmark:windows` to compare six atomic Windows API calls with one batch containing the same six steps. It verifies each workflow, separates fresh-worker startup from warm runs, alternates run order, and writes JSON samples plus a Markdown report. See [benchmark method and recorded results](benchmarks/README.md). Time and character/byte counts are measured locally; model inference and token costs are not measured.

## Structure

- `backend/src/pokemon`: companion lifecycle and serialized action feedback.
- `backend/src/windows`: persistent Win32/UI Automation worker and bounded text responses.
- `backend/src/tools`: computer and Pokémon MCP tools plus the work prompt.
- `frontend/src/main/companion`: dedicated Electron companion mode and authenticated bridge.
- `frontend/src/renderer/companion.*`: desktop overlay, animations, team picker, and activity panel.
- `frontend/pets`: original sprite packs. The original LLM pet-chat mode still launches with `npm start` inside that repository.
- `scripts`: shared setup, build, demo, and verification commands.
- `config`: generated MCP client configuration for this project location.

Windows is the verified platform. The source build and self-contained ZIP/MCPB packages are supported development and distribution paths; this project is not published as an npm package. macOS/Linux generic-input paths require platform testing and their usual desktop accessibility/capture permissions. Windows uses native application controls; macOS/Linux retain the optional agent-desktop 2.6 bridge, which still needs live-host validation. See the [adoption audit](docs/reference-adoption.md) for verified improvements and remaining work.

Pokémon names and assets belong to Nintendo / Creatures Inc. / GAME FREAK. This is an unofficial fan project. Original repositories retain their MIT licenses.
