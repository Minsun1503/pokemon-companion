# computer-use-mcp

This checkout integrates an animated Pokémon frontend from the adjacent `frontend` repository. See [the project guide](../README.md) for setup, Claude/Codex connection examples, and the additional `pokemon` and `windows` tools. The existing `computer` tool now shows automatic character activity while performing actions.

On Windows, use the **`windows` tool first**: `get_windows` → `get_ui` with narrow filters → supported control actions (`invoke`, `set_value`, `select`, etc.) → `get_ui` to verify. It uses Win32 and Windows UI Automation and returns bounded text without images. Fall back to keyboard shortcuts, then screenshots, when an app's accessibility API cannot expose what the task needs. See the workspace guide for examples and `npm run test:windows` for the live API check.

💻 A Model Context Protocol server for Claude to control your computer. This is very similar to [computer use](https://docs.anthropic.com/en/docs/build-with-claude/computer-use), but easy to set up and use locally.

Here's Claude Haiku 4.5 changing my desktop background (4x speed):

https://github.com/user-attachments/assets/cd0bc190-52c4-49db-b3bc-4b8a74544789

> [!WARNING]
> At time of writing, models make frequent mistakes and are vulnerable to prompt injections. As this MCP server gives the model complete control of your computer, this could do a lot of damage. You should therefore treat this like giving a hyperactive toddler access to your computer - you probably want to supervise it closely, and consider only doing this in a sandboxed user account.

## Installation

Use [the companion installation guide](../INSTALL.md): open the bundled `.mcpb` in Claude Desktop, or use the ZIP's installers for Claude Code and Codex. Build the complete Windows package with `npm run package:windows` from the project root. The original backend's published npm package does not include this Pokémon integration.

## Tips

This should just work out of the box.

However, to get best results:
- Use a model good at computer use - I recommend [the latest Claude models](https://platform.claude.com/docs/en/about-claude/models/overview).
- Use a small, common resolution - 720p works particularly well. On macOS, you can use [displayoverride-mac](https://github.com/domdomegg/displayoverride-mac) to do this. If you can't use a different resolution, try zooming in to active windows.
- Install and enable the [Rango browser extension](https://chromewebstore.google.com/detail/rango/lnemjdnjjofijemhdogofbpcedhgcpmb). This enables keyboard navigation for websites, which is far more reliable than Claude trying to click coordinates. You can bump up the font size setting in Rango to make the hints more visible.

## How it works

We implement a near identical computer use tool to [Anthropic's official computer use guide](https://docs.anthropic.com/en/docs/build-with-claude/computer-use), with some more nudging to prefer keyboard shortcuts.

This talks to your computer using [nut.js](https://github.com/nut-tree/nut.js)

## Contributing

Pull requests are welcomed on GitHub! To get started:

1. Install Git and Node.js
2. Clone the repository
3. Install dependencies with `npm install`
4. Run `npm run test` to run tests
5. Build with `npm run build`

## Releases

Versions follow the [semantic versioning spec](https://semver.org/).

To release:

1. Use `npm version <major | minor | patch>` to bump the version
2. Run `git push --follow-tags` to push with tags
3. Wait for GitHub Actions to publish to the NPM registry.
