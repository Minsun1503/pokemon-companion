import type { Provider } from '../../types'

export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>()

  register(provider: Provider): void {
    this.providers.set(provider.id, provider)
  }

  get(providerId: string): Provider {
    const provider = this.providers.get(providerId)
    if (!provider) {
      throw new Error(`Unknown AI provider: ${providerId}`)
    }
    return provider
  }
}
