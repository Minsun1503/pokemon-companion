# Pokémon assistant team: design provenance

Reviewed 2026-11-18. This integration is original TypeScript implementation inside the existing Pokémon harness. It does not install, launch, or vendor another gateway. Upstream behavior is a design reference, not proof of Pokémon behavior or performance.

## References and ideas adopted

- [OpenClaw multi-agent routing](https://docs.openclaw.ai/concepts/multi-agent), repository HEAD `5f8e44aa7d1c29e8841a133031c61cdb0df964e1` when reviewed: coordinator as the human's point of contact; bounded specialist contracts; separate context; specialists cannot delegate recursively. Pokémon implements a `delegate` tool and gives each assignment a fresh transcript. It does not adopt OpenClaw account routing, configuration, role text, or its runtime.
- [Hermes Agent](https://github.com/NousResearch/hermes-agent/tree/91cb42b51bddc6841c4e50183c41c96d59e48516): isolated subagents, per-specialist model choice, messaging gateway, explicit persistent knowledge, and tool selection. Pokémon keeps its own Telegram admission/approval code and encrypted store; adds per-role route selection, user-saved preferences and scoped tool discovery. It does not claim automatic skill learning or import Hermes' runtime.
- [Anthropic MCP context efficiency](https://www.anthropic.com/research/code-execution-with-mcp): load relevant tools instead of sending every definition on every team turn. Pokémon's `find_tools` enables up to six matching tools per discovery. This is bounded discovery, not an embedding search engine.

Hermes and OpenClaw both publish MIT licenses. No upstream source code or verbatim role contracts have been copied into this change. For clarity and future reuse, the notices for the reviewed projects are retained below. Any future source copying must retain the applicable notice and record file/revision provenance here.

## Upstream notices

### Hermes Agent

MIT License

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### OpenClaw

MIT License

Copyright (c) 2026 OpenClaw Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
