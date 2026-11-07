import type { AnthropicConfig, Provider, StreamHandlers, StreamRequest } from '../../../types'
import { consumeSse, requireApiKey, splitMessages } from '../provider-utils'

export class AnthropicProvider implements Provider {
  readonly id = 'anthropic'

  constructor(private readonly config: AnthropicConfig) {}

  async streamChat({ messages, model }: StreamRequest, handlers: StreamHandlers): Promise<void> {
    const apiKey = requireApiKey(this.config, 'Anthropic')

    const { system, conversation } = splitMessages(messages)

    const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'anthropic-version': this.config.apiVersion,
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        model: model || this.config.model,
        system: system || undefined,
        messages: conversation,
        max_tokens: this.config.maxOutputTokens,
        temperature: this.config.temperature,
        stream: true,
      }),
    })

    if (!response.ok) {
      throw new Error(`Anthropic HTTP ${response.status}: ${await response.text()}`)
    }

    await consumeSse(response, (event) => {
      if (event.type === 'content_block_delta') {
        const delta = event.delta as Record<string, unknown> | undefined
        if (delta?.type === 'text_delta') {
          handlers.onChunk(delta.text as string)
        }
      } else if (event.type === 'error') {
        const err = event.error as Record<string, unknown> | undefined
        throw new Error((err?.message as string) || 'Anthropic stream error')
      }
    })
  }
}
