**English** | [한국어](README.ko.md)

# Pokemon Pet

This checkout also provides the animated frontend for the adjacent Pokémon Computer Companion MCP project. See [the workspace guide](../README.md) for running the MCP mode with all seven characters. The original desktop-pet chat mode below remains available.

A transparent desktop pet powered by an LLM. Your Pokémon wanders around your screen and you can open a chat window to talk with it.

# Preview
<img width="448" height="506" alt="스크린샷 2026-06-10 오후 4 16 17" src="https://github.com/user-attachments/assets/2ebfed14-913c-4eeb-92f7-58657df8ae9d" />



## Features

- **Free roaming:** The pet wanders around your screen on its own!
- **Chat:** Click the pet to open a chat window.
- **Idle chatter:** When idle, the pet will speak up on its own. Add custom lines to `idlePhrases` in `pet.json`.
- **Drag and drop:** You can drag the pet anywhere on screen.
- **Summon shortcut:** Press `Ctrl+Shift+R` (or `Cmd+Shift+R` on macOS) from any app to teleport the pet to your cursor.
- **Nickname:** Click the name in the chat titlebar to set a nickname.
- **Pet switcher:** Use the dropdown in the chat titlebar to switch between bundled pets.
- **Per-pet profiles:** Nicknames and chat history are saved separately for each pet.
- **Message menu:** Right-click any message to copy, delete, or resend.

## Included Pokemon

| Pokemon | Pet ID | Development launch |
|---|---|---|
| 리오르 (Riolu) | `riolu` | `npm start -- riolu` |
| 루카리오 (Lucario) | `lucario` | `npm start -- lucario` |
| 토오 (Clodsire) | `clodsire` | `npm start -- clodsire` |
| 피카츄 (Pikachu) | `pikachu` | `npm start -- pikachu` |
| 이상해씨 (Bulbasaur) | `bulbasaur` | `npm start -- bulbasaur` |
| 파이리 (Charmander) | `charmander` | `npm start -- charmander` |
| 꼬부기 (Squirtle) | `squirtle` | `npm start -- squirtle` |

## Download

Get the latest release from [Releases](https://github.com/DEV-asdf-516/Pokemon-pets/releases/latest).

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `Pokemon-Pet-x.x.x-arm64.dmg` |
| Windows | `Pokemon-Pet-x.x.x-Setup.exe` |
| Linux | `Pokemon-Pet-x.x.x.AppImage` |

## Development

Requires Node.js 20.9+ and npm.

```bash
npm install
npm start
```

To launch a specific Pokemon in development mode, pass its pet ID after `--`:

```bash
npm start -- pikachu
npm start -- --pikachu
npm start -- lucario
npm start -- clodsire
```

The chat titlebar also includes a pet dropdown. Choosing a different pet saves the selection and restarts the app.

If the app is already running, quit it before starting with a different pet.

## AI provider

Ollama is the default and requires no API key. To switch providers, add the relevant key to `.env` in the project root and update your settings file.

On first launch the app copies `config/setting.json` to a user-writable location. If you need an API key (OpenAI / Anthropic / Gemini), also place a `.env` file in the same folder.

Files: `setting.json` (provider/model config), `.env` (API keys, optional), `pets/` (editable pet packs)

During development (`npm start`), Electron creates the `pokemon-pet` user-data folder from the app name. A packaged or installed app may use a folder based on its display name depending on the environment.

### macOS

User-data folder: `~/Library/Application Support/pokemon-pet/`

Locate the settings file:

```bash
find "$HOME/Library/Application Support" -maxdepth 3 -name setting.json 2>/dev/null | grep -Ei "pokemon|pet"
```

Reveal the development settings file in Finder:

```bash
open -R "$HOME/Library/Application Support/pokemon-pet/setting.json"
```

### Windows

User-data folder: `%APPDATA%\pokemon-pet\`

Locate the settings file in PowerShell:

```powershell
Get-ChildItem "$env:APPDATA" -Filter setting.json -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match "pokemon|pet" } |
  Select-Object -ExpandProperty FullName
```

Open the development settings file:

```powershell
notepad "$env:APPDATA\pokemon-pet\setting.json"
```

### Linux

User-data folder: `~/.config/pokemon-pet/`

Locate the settings file:

```bash
find "${XDG_CONFIG_HOME:-$HOME/.config}" -maxdepth 3 -name setting.json 2>/dev/null | grep -Ei "pokemon|pet"
```

Open the development settings file with the default application:

```bash
xdg-open "${XDG_CONFIG_HOME:-$HOME/.config}/pokemon-pet/setting.json"
```

Bundled pet packs are copied into `pets/` when missing. Existing user copies are never overwritten, so prompts, sprites, behavior, and themes can be edited directly.

Full configuration reference: [docs/AI_PROVIDERS.md](docs/AI_PROVIDERS.md)

## Adding a new pet

How to add a new Pokémon:

[docs/ADDING_POKEMON.md](docs/ADDING_POKEMON.md)

Asset bundles can be installed and validated in one command:

```bash
npm run install:pet -- assets/lucario/lucario.bundle.json --force
```

## Architecture

Runtime boundaries and extension points: [ARCHITECTURE.md](ARCHITECTURE.md)

## Build

```bash
npm run dist:mac   # macOS arm64
npm run dist       # current platform
```

## Notes

- Vibe-coded.
- The Claude and OpenAI providers have not been thoroughly tested. Please report any issues.

## Disclaimer

Pokémon and all related names, images, and sounds are trademarks of and © Nintendo / Creatures Inc. / GAME FREAK inc. This project is an unofficial fan work and is not affiliated with, endorsed by, or connected to Nintendo or The Pokémon Company in any way. All Pokémon assets used in this project are the property of their respective owners.
