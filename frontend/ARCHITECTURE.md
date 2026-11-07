**English** | [한국어](ARCHITECTURE.ko.md)

# Architecture

## Runtime boundaries

- `main.js`: Electron bootstrap only.
- `src/main/window`: transparent desktop window and display placement.
- `src/main/ipc`: the only IPC channel registration point.
- `src/main/services`: persistence and pet-pack loading.
- `src/main/ai`: provider registry and provider implementations.
- `src/preload`: the narrow API exposed to the renderer.
- `src/renderer`: DOM UI, movement, animation, and chat presentation.
- `pets/<id>`: character manifest, prompt, sprites, sounds, and phrases.
- `config/setting.json`: active pet and AI provider/model selection.

## Adding an AI provider

Configuration and usage: `docs/AI_PROVIDERS.md`.

Create a provider with an `id` and this method:

```js
async streamChat({ messages, model }, { onChunk }) {}
```

Register it in `src/main/index.js`, then add its configuration under `ai` in
`config/setting.json`. The renderer only sends the configured provider ID and
does not depend on provider-specific response formats.

## Adding a pet

Reproducible procedure: `docs/ADDING_POKEMON.md`.

Copy `pets/riolu` to `pets/<new-id>` and update:

- `pet.json` for appearance, movement, text, and asset paths.
- `prompt.txt` for the character system prompt.
- `sprites.json` containing the animation frame map.
- `sprites-manifest.json` for source-sheet and sprite-generation metadata.

Set `pet.active` in `config/setting.json` to the new pet ID.

The sprite map currently supports `down`, `side`, `back_side`, and `back_up`.
