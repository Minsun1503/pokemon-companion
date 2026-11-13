# Local MCP configuration

Run `npm run config` from the project root to generate Claude Desktop and Codex configuration for your checkout's paths. Machine-specific generated files are excluded from Git.

Local configurations launch `scripts/start-mcp.cjs`, which loads the backend and frontend from that checkout together and prints the selected checkout to stderr. Run `node scripts/start-mcp.cjs --check` to inspect the paths before restarting. Rebuild in this checkout after changing frontend or backend sources.

For the simplest installation, use the plugin or release downloads described in [INSTALL.md](../INSTALL.md).
