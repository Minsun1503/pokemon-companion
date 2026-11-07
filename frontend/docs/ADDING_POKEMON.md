**English** | [한국어](ADDING_POKEMON.ko.md)

# Adding a Pokemon

This procedure creates a new pet pack without changing application code.

## Install an asset bundle

Official asset bundles generate, validate, and clean temporary source files in
one command:

```bash
unzip lucario-assets.zip -d .
npm run install:pet -- assets/lucario/lucario.bundle.json --force
```

Options:

- `--force`: replace an existing `pets/<id>` directory.
- `--keep-assets`: keep the temporary `assets/<id>` directory.
- `--activate`: set `config/setting.json` to use the installed pet.

The installer restores the previous pet directory when generation or validation
fails. On success, commit the generated `pets/<id>` directory. Temporary bundle
sources and debug files under `assets/<id>` are ignored and removed by default.

Bundles use `formatVersion: 1`. They contain or reference a complete `pet`
definition, `prompt`, sprite data or generation settings, and an optional
manifest. To export an installed pet as a portable bundle:

```bash
npm run bundle:pet -- lucario
```

## 1. Create the pack

Use a lowercase ID containing letters, numbers, or hyphens:

```bash
npm run create:pet -- pikachu "피카츄"
```

This creates:

```text
pets/pikachu/
  pet.json
  prompt.txt
  sprites.json
  sprites-manifest.json
  sprites/
```

## 2. Add sprite frames

Export transparent PNG frames into the `sprites` directory:

```text
pets/pikachu/sprites/
  down-1.png
  down-2.png
  side-1.png
  side-2.png
  back-side-1.png
  back-up-1.png
```

Use a consistent transparent canvas size and bottom-align every frame. The app
can flip side frames horizontally, so one side direction is sufficient.

Edit `sprites.json`:

```json
{
  "down": [
    "sprites/down-1.png",
    "sprites/down-2.png"
  ],
  "side": [
    "sprites/side-1.png",
    "sprites/side-2.png"
  ],
  "back_side": [
    "sprites/back-side-1.png"
  ],
  "back_up": [
    "sprites/back-up-1.png"
  ]
}
```

Each required animation must contain at least one frame. Base64 data URLs are
also accepted, but relative PNG paths are easier to maintain.

## 3. Configure behavior

Edit `pet.json`.

Important fields:

- `id`: must exactly match the folder name.
- `name`: default name displayed in the chat header.
- `promptFile`: character prompt file relative to the pet folder.
- `spritesFile`: sprite map relative to the pet folder.
- `cryUrl`: optional HTTPS audio URL; use an empty string for no sound.
- `recallText`: speech bubble shown when the pet is recalled from the shortcut or tray.
- `responseCryKeywords`: strings that trigger the cry when present in an AI response; use an empty array to disable.
- `theme`: chat accent, hover, glow, and assistant-message colors.
- `appearance`: movement bounds and rendered image size.
- `movement`: speed, jump, animation, and idle-talk timing.
- `idlePhrases`: random speech-bubble messages.

`spritesManifestFile` is production metadata only. The runtime does not require
its contents, but keeping source-sheet coordinates and extraction notes makes
the sprite pack reproducible.

## 4. Write the character prompt

Edit `prompt.txt`. Define:

- identity and personality
- language and tone
- world knowledge
- response length
- facts the model must not invent

## 5. Validate the pack

```bash
npm run validate:pet -- pikachu
```

Fix every reported error before selecting the pet.

## 6. Select the pet

For a packaged app, place the completed pet folder under the user-data `pets/`
folder documented in the README. During development, `npm run create:pet`
creates the source pack under the project `pets/` folder.

Edit the user-data `setting.json` for a packaged app, or `config/setting.json`
when preparing the bundled development default:

```json
{
  "pet": {
    "active": "pikachu"
  }
}
```

Restart:

```bash
npm start
```

## 7. Verify behavior

Check all of the following:

1. Front, side, diagonal-back, and back movement show valid frames.
2. Dragging works on each monitor and across monitor boundaries.
3. The chat window opens without covering the pet.
4. The prompt produces the intended character.
5. Idle speech and cry audio work.
6. `npm run validate:pet -- pikachu` passes.

## File-name rules

Runtime file names in `pet.json` and `sprites.json` must exactly match the real
files, including capitalization. The `source_sheet.filename` value inside
`sprites-manifest.json` is documentation only and does not need to exist at
runtime.
