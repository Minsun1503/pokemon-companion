import type { ChatMessage, OllamaConfig, Provider, StreamHandlers, StreamRequest } from '../../../types'
import { consumeNdjson } from '../provider-utils'

export class OllamaProvider implements Provider {
  readonly id = 'ollama'

  constructor(private readonly config: OllamaConfig) {}

  async streamChat({ messages, model }: StreamRequest, handlers: StreamHandlers): Promise<void> {
    const conversation: ChatMessage[] = (messages ?? []).map((message) => ({ ...message }))
    for (let index = conversation.length - 1; index >= 0; index -= 1) {
      if (conversation[index]?.role !== 'user') {
        continue
      }
      conversation[index] = { ...conversation[index], content: `${conversation[index].content}\n/no_think` }
      break
    }

    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || this.config.model,
        messages: conversation,
        stream: true,
        think: false,
        options: this.config.options,
      }),
    })

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`)
    }

    await consumeNdjson(response, (event: Record<string, unknown>) => {
      const message = event.message as Record<string, unknown> | undefined
      const chunk = (message?.content as string) || ''
      if (chunk) {
        handlers.onChunk(chunk)
      }
      return Boolean(event.done)
    })
  }
}
