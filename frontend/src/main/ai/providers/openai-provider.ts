import type { OpenAIConfig, Provider, StreamHandlers, StreamRequest } from '../../../types'
import { consumeSse, requireApiKey, splitMessages } from '../provider-utils'

export class OpenAIProvider implements Provider {
  readonly id = 'openai'

  constructor(private readonly config: OpenAIConfig) {}

  async streamChat({ messages, model }: StreamRequest, handlers: StreamHandlers): Promise<void> {
    const apiKey = requireApiKey(this.config, 'OpenAI')
    const { system, conversation } = splitMessages(messages)
    const response = await fetch(`${this.config.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || this.config.model,
        instructions: system || undefined,
        input: conversation,
        max_output_tokens: this.config.maxOutputTokens,
        temperature: this.config.temperature,
        stream: true,
      }),
    })

    if (!response.ok) {
      throw new Error(`OpenAI HTTP ${response.status}: ${await response.text()}`)
    }

    await consumeSse(response, (event) => {
      if (event.type === 'response.output_text.delta' && event.delta) {
        handlers.onChunk(event.delta as string)
      } else if (event.type === 'response.failed') {
        const err = (event.response as Record<string, unknown> | undefined)?.error as
          | Record<string, unknown>
          | undefined
        throw new Error((err?.message as string) || 'OpenAI request failed')
      } else if (event.type === 'error') {
        throw new Error((event.message as string) || 'OpenAI stream error')
      }
    })
  }
}
