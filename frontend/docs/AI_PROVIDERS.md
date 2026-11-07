**English** | [한국어](AI_PROVIDERS.ko.md)

# AI Providers

The app supports `ollama`, `openai`, `anthropic`, and `gemini`.

## Select a provider

Edit `config/setting.json`:

```json
{
  "ai": {
    "provider": "openai"
  }
}
```

Valid values:

- `ollama`
- `openai`
- `anthropic`
- `gemini`

Restart the app after changing the provider or model.

## Ollama

No API key is required.

```json
"ollama": {
  "baseUrl": "http://localhost:11434",
  "model": "qwen3:4b"
}
```

Start Ollama before the app:

```bash
ollama serve
npm start
```

## OpenAI GPT

Put the API key in the project root `.env` file:

```dotenv
OPENAI_API_KEY="your-key"
```

Then set:

```json
"provider": "openai"
```

The implementation uses the Responses API with streaming. Change
`ai.openai.model` if your account uses another model ID.

## Anthropic Claude

```dotenv
ANTHROPIC_API_KEY="your-key"
```

Then set:

```json
"provider": "anthropic"
```

The implementation uses the Messages API with streaming.
The default model is the higher-tier `claude-opus-4-8` model.

## Google Gemini

```dotenv
GEMINI_API_KEY="your-key"
```

Then set:

```json
"provider": "gemini"
```

The implementation uses `streamGenerateContent` with SSE.

## Security

Do not put API keys in `config/setting.json` or commit them to source control.
Keys are loaded from the project root `.env` file or inherited environment.
The `.env` file is ignored by Git and excluded from packaged builds.

## Troubleshooting

- `API key is missing`: add the required key to `.env`, then restart the app.
- HTTP `401` or `403`: verify the key and account permissions.
- HTTP `404`: the configured model ID is unavailable; replace the model value.
- Packaged builds intentionally exclude `.env`; use inherited environment
  variables or add a secure key-management UI for distributed apps.

Official references:

- OpenAI Responses API: https://developers.openai.com/api/reference/resources/responses/methods/create
- Anthropic streaming: https://platform.claude.com/docs/en/build-with-claude/streaming
- Gemini streaming: https://ai.google.dev/api/generate-content
