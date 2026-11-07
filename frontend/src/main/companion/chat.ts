import fs from 'node:fs'
import path from 'node:path'
import type { ChatMessage, Settings } from '../../types'
import type { CompanionChatReply } from '../../types/companion'
import { ProviderRegistry } from '../ai/provider-registry'
import { AnthropicProvider } from '../ai/providers/anthropic-provider'
import { GeminiProvider } from '../ai/providers/gemini-provider'
import { OllamaProvider } from '../ai/providers/ollama-provider'
import { OpenAIProvider } from '../ai/providers/openai-provider'
import type { PetRegistry } from '../services/pet-registry'
import { PetScopedStore } from '../services/pet-scoped-store'

/** Conversations are separate from the AI client's computer-control session. */
export class CompanionChat {
  private readonly pending = new Set<string>()

  constructor(
    private readonly rootDir: string,
    private readonly userData: string,
    private readonly pets: PetRegistry,
  ) {}

  history(pet: string): ChatMessage[] {
    this.pets.load(pet)
    return this.store(pet).read()
  }

  async reply(pet: string, text: unknown): Promise<CompanionChatReply> {
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) {
      return { ok: false, error: 'Please write a message of up to 4,000 characters.' }
    }
    if (this.pending.has(pet)) return { ok: false, error: 'Your Pokémon is still replying. Give it a moment.' }
    this.pending.add(pet)
    try {
      const definition = this.pets.load(pet)
      const store = this.store(pet)
      const history = store.read()
      const user: ChatMessage = { role: 'user', content: text.trim() }
      let content = ''
      const settings = this.settings()
      const providers = new ProviderRegistry()
      providers.register(new OllamaProvider(settings.ai.ollama))
      providers.register(new OpenAIProvider(settings.ai.openai))
      providers.register(new AnthropicProvider(settings.ai.anthropic))
      providers.register(new GeminiProvider(settings.ai.gemini))
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: `${definition.prompt}\n\nReply in the user's language. You are their friendly desktop companion. Keep replies short and natural. This conversation cannot operate their computer; never claim to perform computer actions here.`,
        },
        ...history.slice(-10),
        user,
      ]
      await providers.get(settings.ai.provider).streamChat(
        { messages, model: settings.ai[settings.ai.provider].model },
        {
          onChunk: (chunk) => {
            content += chunk
          },
        },
      )
      content = content.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim()
      if (!content) throw new Error('No reply was received. Please try again.')
      const assistant: ChatMessage = { role: 'assistant', content }
      if (!store.write([...history, user, assistant].slice(-200))) {
        return { ok: false, error: 'The conversation could not be saved. Please check the app data folder.' }
      }
      return { ok: true, content }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        error: /fetch failed|ECONNREFUSED/i.test(message)
          ? 'Your chat model is offline. Start the configured AI provider (Ollama by default), then try again.'
          : message,
      }
    } finally {
      this.pending.delete(pet)
    }
  }

  private store(pet: string): PetScopedStore<ChatMessage[]> {
    return new PetScopedStore(
      path.join(this.userData, 'companion_chats.json'),
      pet,
      [],
      (value): value is ChatMessage[] =>
        Array.isArray(value) &&
        value.every(
          (item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string',
        ),
    )
  }

  private settings(): Settings {
    const loadEnvFile = (process as unknown as { loadEnvFile?: (file: string) => void }).loadEnvFile
    for (const file of [path.join(this.rootDir, '.env'), path.join(this.userData, '.env')]) {
      if (fs.existsSync(file)) loadEnvFile?.(file)
    }
    const file = path.join(this.userData, 'setting.json')
    return JSON.parse(
      fs.readFileSync(fs.existsSync(file) ? file : path.join(this.rootDir, 'config/setting.json'), 'utf8'),
    ) as Settings
  }
}
