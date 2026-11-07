import type { ChatMessage } from '../../types'

export function requireApiKey(config: { apiKeyEnv?: string }, providerName: string): string {
  const envName = config.apiKeyEnv
  const apiKey = envName ? process.env[envName] : ''
  if (!apiKey) {
    throw new Error(`${providerName} API key is missing. Set ${envName}.`)
  }
  return apiKey
}

export function splitMessages(messages: ChatMessage[]): {
  system: string
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>
} {
  const system: string[] = []
  const conversation: Array<{ role: 'user' | 'assistant'; content: string }> = []

  for (const message of messages ?? []) {
    if (!message || typeof message.content !== 'string') {
      continue
    }
    if (message.role === 'system') {
      system.push(message.content)
    } else if (message.role === 'user' || message.role === 'assistant') {
      conversation.push({ role: message.role, content: message.content })
    }
  }

  return { system: system.join('\n\n'), conversation }
}

export async function consumeNdjson(
  response: Response,
  onEvent: (event: Record<string, unknown>) => boolean | undefined,
): Promise<void> {
  const reader = getResponseReader(response)
  const decoder = new TextDecoder()
  let buffer = ''

  const handleLine = (line: string): boolean => {
    if (!line.trim()) {
      return false
    }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch {
      return false
    }
    return onEvent(parsed) === true
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (handleLine(line)) {
        return
      }
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) {
    handleLine(buffer)
  }
}

export async function consumeSse(response: Response, onEvent: (event: Record<string, unknown>) => void): Promise<void> {
  const reader = getResponseReader(response)
  const decoder = new TextDecoder()
  let buffer = ''

  const consumeBlock = (block: string): void => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')

    if (!data || data === '[DONE]') {
      return
    }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(data) as Record<string, unknown>
    } catch {
      return
    }
    onEvent(parsed)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      consumeBlock(block)
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) {
    consumeBlock(buffer)
  }
}

function getResponseReader(response: Response): ReadableStreamDefaultReader<Uint8Array> {
  if (!response.body) {
    throw new Error('Response body is missing')
  }
  return response.body.getReader()
}
