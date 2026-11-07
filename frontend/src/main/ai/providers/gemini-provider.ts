import type { GeminiConfig, Provider, StreamHandlers, StreamRequest } from '../../../types'
import { consumeSse, requireApiKey, splitMessages } from '../provider-utils'

export class GeminiProvider implements Provider {
  readonly id = 'gemini'

  constructor(private readonly config: GeminiConfig) {}

  async streamChat({ messages, model }: StreamRequest, handlers: StreamHandlers): Promise<void> {
    const apiKey = requireApiKey(this.config, 'Gemini')

    const { system, conversation } = splitMessages(messages)

    const modelId = encodeURIComponent(model || this.config.model)

    let emittedText = ''

    const endpoint = `${this.config.baseUrl}/v1beta/models/${modelId}:streamGenerateContent`

    const response = await fetch(`${endpoint}?alt=sse&key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: system ? { parts: [{ text: system }] } : undefined,
        contents: conversation.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          temperature: this.config.temperature,
          maxOutputTokens: this.config.maxOutputTokens,
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`Gemini HTTP ${response.status}: ${await response.text()}`)
    }

    await consumeSse(response, (event) => {
      if (event.error) {
        const err = event.error as Record<string, unknown>
        throw new Error((err.message as string) || 'Gemini stream error')
      }
      const candidates = event.candidates as Array<Record<string, unknown>> | undefined
      const candidate = candidates?.[0]
      const finishReason = candidate?.finishReason as string | undefined

      if (finishReason && !['STOP', 'MAX_TOKENS', 'FINISH_REASON_UNSPECIFIED'].includes(finishReason)) {
        throw new Error(`Gemini blocked: ${finishReason}`)
      }
      const parts = (candidate?.content as Record<string, unknown> | undefined)?.parts as
        | Array<Record<string, unknown>>
        | undefined
      const text = parts?.map((part) => (part.text as string) || '').join('')
      if (!text) {
        return
      }

      if (text.startsWith(emittedText)) {
        const delta = text.slice(emittedText.length)
        emittedText = text
        if (delta) {
          handlers.onChunk(delta)
        }
        return
      }

      emittedText = text
      handlers.onChunk(text)
    })
  }
}
