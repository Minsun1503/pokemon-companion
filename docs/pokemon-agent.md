# Pokémon Agent and Telegram

Pokémon Agent is our own TypeScript harness. It connects model APIs to the existing Pokémon browser and desktop tools, with encrypted sessions and private Telegram approvals. Hermes is an architectural reference; installing or running Hermes is unnecessary.

## Start

From the active `.publish` checkout, after the usual `npm run setup` and `npm run build`:

```powershell
npm run agent -- setup
```

This starts the companion and opens a local setup page. Enter a provider API key and the exact model ID available on that endpoint, save the route, and select it as the default. Configure a bot token from [BotFather](https://t.me/BotFather), add your numeric Telegram user ID to the allowlist, and enable Telegram. To control the PC from a group, add its exact negative chat ID to Allowed group IDs. Only listed users in designated groups or private chats are admitted. Keep the process running and the desktop unlocked for native control.

The standalone portable build scripts include **Start Pokemon Agent.cmd** on Windows or **Start Pokemon Agent.command** on macOS/Linux. These use the bundled Node, Electron, Chromium and desktop helpers. Provider credentials and the Telegram bot are configured once by the owner; browser site logins remain the owner's responsibility. Existing downloaded releases need rebuilding to include the new gateway and launcher.

`npm run agent -- run` starts with saved settings without opening setup. `status` reports configuration without revealing secrets; `check` lists the real tools and checks desktop readiness; `init` creates default configuration. Ctrl+C shuts down the gateway and its owned companion/browser. `POKEMON_AGENT_NO_OPEN=1` suppresses opening setup.

For Windows autostart from this source checkout, run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-agent-autostart.ps1`, then `Start-ScheduledTask -TaskName 'Pokemon Agent Telegram'`. The Windows portable package includes `Enable Pokemon Agent Autostart.cmd` and uses its bundled Node runtime. Stop any manually started gateway first; one process owns the encrypted profile. The task runs hidden at your next Windows sign-in, retries a failed process up to three times at one-minute intervals, and prevents automatic system sleep while running. The setup page uses loopback port 56727; its authorization token changes at every start and is recorded in `%LOCALAPPDATA%/pokemon-companion/harness/agent.stdout.log`. No API credentials appear in the task arguments. This is a user-session task: native control requires you to stay signed in with an unlocked desktop, and it cannot run while the PC is shut down. To disable it, use `Disable-ScheduledTask -TaskName 'Pokemon Agent Telegram'`; to stop it now, use `Stop-ScheduledTask` with that name. Keep this checkout and its Node runtime at their installed paths.

## Models and routes

The desktop relay sends Telegram → Pokémon MCP → the configured ChatGPT desktop conversation → Telegram. In local setup, select the current desktop conversation and enable the relay. A reusable grant authorizes the listed Telegram owners to send questions to that destination; disabling it restores a private approval for every question. Questions use the existing desktop login and bypass provider APIs. Keep this conversation open and the desktop unlocked. Claude web remains excluded from this relay.

Use `/ask@your_bot your question` in the designated group or send a private question directly. Ordinary mentioned messages and `/task` also use the enabled desktop relay. `/api your instruction` keeps the API model/tool loop available. `/model` selects the route for API tasks; `/new` clears only API task history. The relay queues work, waits up to ten minutes for an idle chat, verifies the complete draft, submits once, waits up to ten minutes for a new stable completed answer, and returns its text. `/stop` cancels waiting without resending. It leaves the desktop control lease available while the assistant runs its own tools. Source truncation, target changes, login errors and uncertain delivery are reported instead of returning unrelated or incomplete text. An uncertain submission is journaled and blocked from automatic replay across restarts.

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
| `/task@your_bot your instruction` | Runs your exact instruction from a designated group |
| `/model` | Lists routes and the current selection |
| `/model claude` | Selects that route for this chat |
| `/new` | Clears this chat's conversation |
| `/status` | Reports available routes |
| `/stop` | Cancels this chat's active or queued task |
| `/allow <code>` / `/deny <code>` | Decides the displayed action once |

In groups, mention the bot by its exact username, reply to one of its messages, or use an explicitly addressed command such as `/task@your_bot Open YouTube and search for a song`. Exact mentions are stripped before the instruction reaches the model. Unaddressed conversation, commands addressed to other bots, anonymous admin messages and unlisted users are ignored. For plain mentions to reach the gateway, disable privacy for your bot through BotFather's `/setprivacy`, then remove and re-add it to the group. If you keep privacy enabled, use addressed slash commands or replies. Greetings such as `Hi @your_bot` report the connection and provider setup state without a model request. The result returns to the group. Open the bot privately and send `/start` once before using it; action approvals are delivered privately to the person who requested the task.

The approval message shows the operation, target and complete input. Codes are random, expire after five minutes, are accepted only in the owning private chat, and are consumed once. Approval commands bypass the model; codes are not added to model transcripts or group replies. Browser/API actions also use the existing server-derived target/state checks. Native input and executable launch require a Telegram approval for the complete tool request. Native URL launch and learned workflow replay are blocked in this gateway.

Telegram users share one desktop execution queue, with at most eight tasks. `/stop` remains available during approvals and work. Update admission is encrypted and persisted before execution; a restarted process does not silently replay admitted tasks. Interrupted tasks are not automatically resumed. An uncertain action outcome stops the turn and requires observation before another attempt. Independently running MCP clients are separate processes; pause their work when Telegram controls the same desktop.

## Storage and verification

Settings, encrypted credentials and histories live under `%LOCALAPPDATA%/pokemon-companion/harness` on Windows. `POKEMON_HARNESS_HOME` selects another profile. Credentials can also come from environment variables matching their key names; environment values take precedence. `config.json` holds route metadata and the user allowlist, not keys or bot tokens. AES-256-GCM encrypts the journal; Windows DPAPI protects its key for the current OS user. The setup API listens only on `127.0.0.1`, requires a random bearer token and returns only key-presence flags. The session store permits one writer per profile.

```powershell
npm run test:agent
npm run test:agent:smoke
```

The smoke test executes the real in-process MCP transport, bundled Chromium, fresh DOM references, navigation/fill approvals, encrypted storage and setup controls. Telegram and provider HTTP endpoints are owned local fixtures. It does not establish a working live bot, a valid provider key or a paid model response. Results are recorded in `benchmarks/results/harness-smoke-2026-11-15.json`.

## Hermes reference

Reviewed upstream on 2026-11-15 at commit [`b2c6bc4e`](https://github.com/NousResearch/hermes-agent/tree/b2c6bc4e1e183263907cf81cf070aa8ebdd5a553): [README](https://github.com/NousResearch/hermes-agent/blob/b2c6bc4e1e183263907cf81cf070aa8ebdd5a553/README.md), [agent loop](https://github.com/NousResearch/hermes-agent/blob/b2c6bc4e1e183263907cf81cf070aa8ebdd5a553/run_agent.py), [gateway](https://github.com/NousResearch/hermes-agent/blob/b2c6bc4e1e183263907cf81cf070aa8ebdd5a553/gateway/run.py), and [sessions](https://github.com/NousResearch/hermes-agent/blob/b2c6bc4e1e183263907cf81cf070aa8ebdd5a553/gateway/session.py). These informed separation of model routing, tool execution, messaging and per-chat state. No Hermes source or runtime is bundled. WhatsApp is deferred in favor of Telegram, as requested.
