> Telegram portable (DeepSeek): the dedicated package has one enforced DeepSeek route/key, no fallbacks or desktop relay. Start with AGENT-SETUP.md in that package. The generic source harness capabilities below are not additional providers enabled by the Telegram package.

# Pokémon Agent and Telegram

Vietnamese self-setup guide: [one computer, one bot, one fixed group](telegram-personal-pc-setup.vi.md). Local setup can check saved model credentials and bot/group membership without model generation or Telegram messages. `/whereami@your_bot` privately returns IDs only to an allowlisted sender; it does not authorize a new group.

Pokémon Agent is our own TypeScript harness. It connects model APIs to the existing Pokémon browser and desktop tools, with encrypted sessions and same-chat Telegram approval buttons. Hermes is an architectural reference; installing or running Hermes is unnecessary.

## Start

From the active `.publish` checkout, after the usual `npm run setup` and `npm run build`:

```powershell
npm run agent -- setup
```

This starts the companion and opens a local setup page. Enter a provider API key and the exact model ID available on that endpoint, save the route, and select it as the default. Configure a bot token from [BotFather](https://t.me/BotFather), add your numeric Telegram user ID to the allowlist, and enable Telegram. To control the PC from a group, add its exact negative chat ID to Allowed group IDs. Only listed users in designated groups or private chats are admitted. Keep the process running and the desktop unlocked for native control.

The standalone portable build scripts include **Start Pokemon Agent.cmd** on Windows or **Start Pokemon Agent.command** on macOS/Linux. These use the bundled Node, Electron, Chromium and desktop helpers. Provider credentials and the Telegram bot are configured once by the owner; browser site logins remain the owner's responsibility. Existing downloaded releases need rebuilding to include the new gateway and launcher.

`npm run agent -- run` starts with saved settings without opening setup. `status` reports configuration without revealing secrets; `check` lists the real tools and checks desktop readiness; `init` creates default configuration. Ctrl+C shuts down the gateway and its owned companion/browser. `POKEMON_AGENT_NO_OPEN=1` suppresses opening setup.

For Windows autostart from this source checkout, run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-agent-autostart.ps1`, then `Start-ScheduledTask -TaskName 'Pokemon Agent Telegram'`. The Windows portable package includes `Enable Pokemon Agent Autostart.cmd` and uses its bundled Node runtime. Stop any manually started gateway first; one process owns the encrypted profile. The task runs hidden at your next Windows sign-in, retries a failed process up to three times at one-minute intervals, and prevents automatic system sleep while running. The setup page uses loopback port 56727; its authorization token changes at every start and is recorded in `%LOCALAPPDATA%/pokemon-companion/harness/agent.stdout.log`. No API credentials appear in the task arguments. This is a user-session task: native control requires you to stay signed in with an unlocked desktop, and it cannot run while the PC is shut down. To disable it, use `Disable-ScheduledTask -TaskName 'Pokemon Agent Telegram'`; to stop it now, use `Stop-ScheduledTask` with that name. Keep this checkout and its Node runtime at their installed paths.

## Assistant team

The built-in team adopts bounded delegation and isolated specialist context from the designs documented in [agent-team-sources.md](agent-team-sources.md). It runs inside Pokémon; no Hermes/OpenClaw installation or new bot is needed.

Register by mentioning the bot or sending `/session@your_bot` in an allowed group, then send ordinary text or `/team your task` in its private chat. Group messages only register/open a session and never execute tasks. This explicitly uses provider APIs, even when desktop relay is enabled. `/team` alone shows the roster without a model request. A coordinator can answer directly, discover tools, or delegate independent assignments to researcher, writer, analyst and reviewer. Children see the current human request and only the assignment/context provided by the coordinator, not prior chat history or another child's transcript. They cannot recursively delegate. Writer/reviewer have no external tools; researcher can use browser/research/course tools; analyst can use Excel. The coordinator uses `find_tools` before external tools are exposed. Native and browser/API approvals remain enforced.

In local setup, **Assistant team** configures enablement, automatic team routing for ordinary API work, specialist parallelism (default 2), total assignments (6), shared model-request limit (24), token reservations (100,000), output cap (2,048), optional configured-price USD budget, and optional per-role route names. Blank specialist routes inherit the chat's `/model` route. Older configuration files work without a team section. Automatic team routing is off by default; `/team` is immediately available when API credentials/model are configured. `/ask` always retains its explicit desktop-relay semantics.

The team has no model planning call before the coordinator, and no mandatory reviewer pass. Up to four root team tasks can reason concurrently, within the existing eight-task admission limit. Model-only specialists can overlap. Tool-using specialists run in one lane per task. A task lazily acquires the shared runtime lease before external tools, retaining it across observation/action/model rounds until completion; another desktop task cannot invalidate those observations. The legacy path retains its full-turn lease for compatibility. This is coordination within this gateway; independently running MCP clients still need to avoid controlling the same desktop simultaneously.

Team commands:

| Command | Behavior |
| --- | --- |
| `/team instruction` | Run the coordinator and only the specialists it needs |
| `/tasks` | List this chat's recent team tasks |
| `/taskstatus ID` | Show task state, recent checkpoints and saved result |
| `/budget` | Show per-task limits and recent retained usage/cost estimates |
| `/remember preference` | Explicitly save up to 500 characters; retain up to 20 notes per chat |
| `/memory` | View this chat's preferences |
| `/forgetmemory` | Clear preferences, preserving task history |
| `/stop` | Abort this chat's running or waiting task and its children |

Preferences are coordinator context, never permission to take actions. Team tasks use a fresh tool transcript. The coordinator receives up to four previous finished task records from the same sender and chat (each request capped at 2,000 characters and result at 1,000, or 4,000 for the latest reply to retain followup choices), including failure status, to resolve followups. This survives restart through the encrypted task ledger. It does not include old tool snapshots, credentials or approval tokens. Within a running task, older successful Windows observations are evicted once a newer read arrives; action outcomes and failed reads are retained. Historical records are context, not renewed approval; uncertain actions require observation before retry. `/new` resets this context boundary without deleting task records. Task requests, specialist artifacts, final results, usage and bounded checkpoint events are stored in the existing encrypted journal. Up to 16 finished tasks plus active work are retained; this is a recent-task ledger, not lifetime billing. On process restart, unfinished tasks become `interrupted`, with no automatic action replay or automatic resume. `/taskstatus` can retrieve a completed result if Telegram delivery failed. A completed task records a coordinator response, not proof that every external outcome is correct; inspect artifacts and evidence.

Optional route `pricing: {input: 2, output: 10}` means USD per million tokens at your configured endpoint. Team mode records OpenAI prompt/completion usage and Anthropic input/output/cache input usage. Requests reserve a byte-based visible-input estimate plus the output cap **before** sending; parallel specialists share this account. Missing usage and failed/uncertain provider requests retain their reservations. Token and USD limits stop subsequent requests; USD mode refuses unpriced routes. These are conservative configured-price estimates, **not a guaranteed provider spending cap**: hidden provider overhead, cache pricing, tool fees, price changes and provider cap enforcement may differ. Use provider-side spend controls for a billing ceiling. Cached-input discounts are not applied. No subscription pricing or live price lookup is assumed.

OpenAI-compatible routes use `max_tokens` for the output cap; official `api.openai.com` uses `max_completion_tokens`. Set route `outputTokenParameter` to either name if a custom endpoint needs a specific field. Anthropic uses `max_tokens`. No live paid provider or live Telegram connection is established by fixture tests.

Verification commands: `npm run test:team` for the team regression tests, `npm run test:team:smoke` after a backend build for the full fixture integration. The smoke exercises Telegram polling, requester-bound approval buttons in the private session, a real in-process MCP browser reading a synthetic local page, parallel writer/reviewer HTTP calls, coordinator synthesis, encrypted artifacts/usage, and setup UI persistence. Its report is `benchmarks/results/team-smoke-latest.json`; the setup screenshot is `benchmarks/results/team-setup-smoke.png`. These fixtures do not measure real model intelligence, provider billing, or live Telegram reliability. Restart an existing gateway at a safe task boundary to load rebuilt code; compiling does not hot-reload a running Node process.

## Models and routes

The desktop relay sends Telegram → Pokémon MCP → the configured ChatGPT desktop conversation → Telegram. In local setup, select the current desktop conversation and enable the relay. A reusable grant authorizes the listed Telegram owners to send questions to that destination; disabling it restores a same-chat approval for every question. Questions use the existing desktop login and bypass provider APIs. Keep this conversation open and the desktop unlocked. Claude web remains excluded from this relay.

After registering in the group, use `/ask your question` in the private chat. Private ordinary messages and `/task` also use the enabled desktop relay. `/api your instruction` keeps the API model/tool loop available. `/model` selects the route for API tasks; `/new` clears only API task history. The relay queues work, waits up to ten minutes for an idle chat, verifies the complete draft, submits once, waits up to ten minutes for a new stable completed answer, and returns its text. `/stop` cancels waiting without resending. It leaves the desktop control lease available while the assistant runs its own tools. Source truncation, target changes, login errors and uncertain delivery are reported instead of returning unrelated or incomplete text. An uncertain submission is journaled and blocked from automatic replay across restarts.

| Route | API format | Default base URL | Key name |
| --- | --- | --- | --- |
| `deepseek` | OpenAI Chat Completions | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` |
| `claude` | Anthropic Messages | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| `openai` | OpenAI Chat Completions | `https://api.openai.com/v1` | `OPENAI_API_KEY` |

Direct APIs and custom routes can coexist. Add a custom route with its own label, API format, base URL, model ID and credential name. It can use an existing OpenAI-compatible or Anthropic-compatible proxy. OpenAI format appends `/chat/completions`; Anthropic appends `/v1/messages` (or `/messages` when the base already ends in `/v1`). HTTPS is required except for loopback HTTP. URLs cannot contain credentials or query parameters.

A ChatGPT web subscription/login is separate from an OpenAI API key and API billing. Models must support tool calling. DeepSeek reasoning returned with tool calls is retained for subsequent calls to that same endpoint/model. Images, voice, streaming, provider OAuth, automatic model discovery and other API formats are not implemented in this first version.

Optional fallback routes are tried in order if a model request fails. They receive the same transcript and completed tool results; fallback does not replay tools. A fallback sends conversation and tool observations to that configured endpoint, so leave the list empty unless you intend that sharing.

## Telegram commands

| Command | Behavior |
| --- | --- |
| A text task | Runs the model/tool loop and reports its result |
| `/task@your_bot your instruction` | In a group, registers/opens the private session; send the instruction privately |
| `/model` | Lists routes and the current selection |
| `/model claude` | Selects that route for this chat |
| `/new` | Clears this chat's conversation |
| `/status` | Reports available routes |
| `/stop` | Cancels this chat's active or queued task |
| Allow / Deny buttons | Decide the displayed action once, in the chat that requested it |

Groups are registration-only. An allowed user mentions the bot or uses /session@your_bot in an allowed group; no group task content reaches the model. The gateway persists a random private-session identity under the bot/user, separate from old group history. Re-registering in the same group reopens it; registering in a different allowed group creates a fresh identity. Private work requires both the allowlisted user and a registration whose group is still allowed. Telegram may require the person to open the returned t.me link and press Start before the bot can DM them. Plain private messages need no mention. Start/help return a short welcome; natural Vietnamese stop/new phrases work without model calls. The default menu contains only start/new/stop. Typing activity replaces accepted/working/completed task-ID chatter; final answers are plain replies. Technical commands and encrypted task records remain available on demand.
