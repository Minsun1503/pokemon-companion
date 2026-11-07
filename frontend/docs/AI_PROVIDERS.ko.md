[English](AI_PROVIDERS.md) | **한국어**

# AI 프로바이더

앱은 `ollama`, `openai`, `anthropic`, `gemini`를 지원합니다.

## 프로바이더 선택

`config/setting.json` 수정:

```json
{
  "ai": {
    "provider": "openai"
  }
}
```

유효한 값:

- `ollama`
- `openai`
- `anthropic`
- `gemini`

프로바이더 또는 모델 변경 후에는 앱을 재시작하세요.

## Ollama

API 키가 필요 없습니다.

```json
"ollama": {
  "baseUrl": "http://localhost:11434",
  "model": "qwen3:4b"
}
```

앱 실행 전에 Ollama를 먼저 시작하세요:

```bash
ollama serve
npm start
```

## OpenAI GPT

프로젝트 루트의 `.env` 파일에 API 키를 추가하세요:

```dotenv
OPENAI_API_KEY="your-key"
```

그 다음 설정:

```json
"provider": "openai"
```

구현체는 스트리밍이 적용된 Responses API를 사용합니다. 계정에서 다른 모델 ID를 사용하는 경우 `ai.openai.model`을 변경하세요.

## Anthropic Claude

```dotenv
ANTHROPIC_API_KEY="your-key"
```

그 다음 설정:

```json
"provider": "anthropic"
```

구현체는 스트리밍이 적용된 Messages API를 사용합니다. 기본 모델은 상위 티어인 `claude-opus-4-8`입니다.

## Google Gemini

```dotenv
GEMINI_API_KEY="your-key"
```

그 다음 설정:

```json
"provider": "gemini"
```

구현체는 SSE 방식의 `streamGenerateContent`를 사용합니다.

## 보안

API 키를 `config/setting.json`에 넣거나 소스 컨트롤에 커밋하지 마세요. 키는 프로젝트 루트의 `.env` 파일 또는 상속된 환경 변수에서 로드됩니다. `.env` 파일은 Git에서 무시되며 패키징된 빌드에서도 제외됩니다.

## 문제 해결

- `API key is missing`: `.env`에 필요한 키를 추가한 뒤 앱을 재시작하세요.
- HTTP `401` 또는 `403`: 키와 계정 권한을 확인하세요.
- HTTP `404`: 설정된 모델 ID를 사용할 수 없습니다; 모델 값을 교체하세요.
- 패키징된 빌드는 의도적으로 `.env`를 제외합니다; 상속된 환경 변수를 사용하거나 배포용 앱에는 안전한 키 관리 UI를 추가하세요.

공식 레퍼런스:

- OpenAI Responses API: https://platform.openai.com/docs/api-reference/responses
- Anthropic 스트리밍: https://docs.anthropic.com/en/api/messages-streaming
- Gemini 스트리밍: https://ai.google.dev/api/generate-content
