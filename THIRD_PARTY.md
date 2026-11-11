# Original repositories

Pokémon Companion combines and modifies these two MIT-licensed projects. Their source is included directly in this repository so cloning this project gets both components.

| Included folder | Original repository | Imported base commit | Original author |
| --- | --- | --- | --- |
| `frontend/` | [DEV-asdf-516/Pokemon-pets](https://github.com/DEV-asdf-516/Pokemon-pets) | [`9cf50bd`](https://github.com/DEV-asdf-516/Pokemon-pets/commit/9cf50bd863ed1752161fdc804026572fd94e37dc) | DEV-asdf-516 |
| `backend/` | [domdomegg/computer-use-mcp](https://github.com/domdomegg/computer-use-mcp) | [`6d22004`](https://github.com/domdomegg/computer-use-mcp/commit/6d22004ef5477a5a768ea0658217b7cff68b11bf) | Adam Jones (domdomegg) |

The original copyright notices and MIT licenses remain in [frontend/LICENSE](frontend/LICENSE) and [backend/LICENSE](backend/LICENSE). Companion integration, Windows UI Automation, action feedback, menus, and combined packaging are changes made in this project.

[DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) inspired the simple plugin installation flow. Its source is not bundled.

Pokémon names and graphics belong to Nintendo / Creatures Inc. / GAME FREAK. This is an unofficial fan project. The MIT licenses cover the project code; they do not grant ownership of Pokémon trademarks or character artwork.

Hello Kitty and Kuromi belong to Sanrio. Their sprite packs are fan artwork generated through ChatGPT for this project, using the existing Pokémon sprites as style references. No official Sanrio artwork is bundled. The project license does not grant rights to Sanrio characters or trademarks.

Release bundles include Node, Electron, and npm dependencies with their license files. See the bundled `NOTICE.txt` and component licenses.

macOS/Linux packages also include [vercel-labs/agent-desktop v1.2.0](https://github.com/vercel-labs/agent-desktop/releases/tag/v1.2.0) and its platform helpers, under the Apache License 2.0. The archive checksums are pinned in the build script, and the upstream license is included in `runtime/agent-desktop/LICENSE`. Pokémon uses its JSON response contract version 2.6.
