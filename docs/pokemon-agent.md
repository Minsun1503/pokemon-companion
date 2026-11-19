> Telegram portable (DeepSeek): the dedicated package has one enforced DeepSeek route/key and no fallbacks. Start with TELEGRAM-SETUP-VI.md in that package.

# Pokémon Agent and Telegram

Pokémon Agent is our own TypeScript harness. It runs the full Pokémon MCP server in-process (the same optimized Windows/browser/Excel tools, native worker, guards and companion used by Claude/ChatGPT) and connects it to model APIs and a Telegram bot. Its setup and access model follow [Hermes Agent](https://github.com/NousResearch/hermes-agent): a terminal wizard, DM pairing and a logon service. No Hermes installation is needed. The MCP server for Claude/ChatGPT is unchanged.

## Start

From the active checkout, after `npm run setup` and `npm run build`:

```powershell
npm run agent -- setup
```

The wizard asks for the provider API key (input hidden), lists the models the key can use and saves the chosen model, then asks for the Telegram bot token from [BotFather](https://t.me/BotFather) and verifies it with `getMe` (never `getUpdates`). Secrets go to the encrypted local store, never to `config.json`. It finally offers to install and start the Windows logon service.

**Pairing.** Message the bot privately. An unknown sender receives an 8-character code (valid 1 hour, at most 3 waiting). The owner approves it on the computer with `npm run agent -- pairing approve CODE`; the running gateway picks the change up immediately. `pairing list` shows paired users and waiting codes; `pairing revoke USER_ID` removes access. Strangers never reach the model or tools, and pairing codes are never sent into groups.

**Trust model.** As in Hermes, a paired user's messages authorize the actions they request: there are no per-action Allow/Deny prompts. Pair only people you trust with this computer. `/stop` aborts immediately; after /stop nothing more is authorized. Repeat-mutation and uncertain-delivery guards still stop the loop, and nothing is replayed automatically after a restart.

**Running.** `npm run agent -- gateway` runs the bot in the current window (Ctrl+C stops it and its owned companion/browser). `gateway install` registers the Windows Scheduled Task "Pokemon Agent Telegram" (runs hidden at sign-in, retries up to three times, keeps the system awake while running) and `gateway uninstall` removes it; `gateway start|stop|status` control it. One process owns the encrypted store: stop the gateway before re-running `setup`. `status` reports configuration without secrets; `check` lists the real tools and desktop readiness. Native control needs a signed-in, unlocked desktop.

**Groups (optional).** Add negative chat IDs to `telegram.allowedGroups` in the agent's `config.json`. In those groups the bot answers only paired users who @mention it, reply to it, or use `/command@bot`; each user gets a separate session per group.


## Assistant team

The built-in team adopts bounded delegation and isolated specialist context from the designs documented in [agent-team-sources.md](agent-team-sources.md). It runs inside Pokémon; no Hermes/OpenClaw installation or new bot is needed.

Send `/team your task` (or any message when automatic team routing is on). `/team` alone shows the roster without a model request. A coordinator can answer directly, discover tools, or delegate independent assignments to researcher, writer, analyst and reviewer. Children see the current human request and only the assignment/context provided by the coordinator, not prior chat history or another child's transcript. They cannot recursively delegate. Writer/reviewer have no external tools; researcher can use browser/research/course tools; analyst can use Excel. The coordinator uses `find_tools` before external tools are exposed.

The `team` section of `config.json` configures enablement, automatic team routing for ordinary messages, specialist parallelism (default 2), total assignments (6), shared model-request limit (24), token reservations (100,000), output cap (2,048), optional configured-price USD budget, and optional per-role route names. Blank specialist routes inherit the chat's `/model` route. Older configuration files work without a team section; a leftover `desktopRelay` entry is ignored.


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

Verification: `npm run test:agent` runs the harness regression tests (pairing, gateway, setup wizard, team, provider adapters) with local fixtures. They do not measure model intelligence, provider billing or live Telegram reliability. Restart a running gateway to load rebuilt code.

## Models and routes

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
| `/team instruction` | Runs the specialist team |
| `/model`, `/model claude` | Lists routes / selects a route for this chat |
| `/new` or “bắt đầu phiên mới” | Clears this chat's conversation context |
| `/status`, `/help` | Reports the model route / shows commands |
| `/stop` or “dừng lại” | Cancels this chat's active or queued task |

Private chats need no mention or command. Typing activity is shown while work runs; final answers are plain replies.
