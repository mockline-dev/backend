import config from 'config'
import type { ILLMProvider } from './base'
import { OllamaProvider } from './ollama.provider'
import { OpenAIProvider } from './openai.provider'

// Singleton provider instance — swap this out to support multiple providers.
let _provider: ILLMProvider | null = null

/**
 * Returns the configured LLM provider.
 * Reads `llm.provider` from config (default: "ollama").
 * Supported values: "ollama" | "openai".
 *
 * If the resolved provider fails its health check on first use, the registry
 * falls back to the next available provider and logs a warning.
 */
export function getProvider(): ILLMProvider {
  if (!_provider) {
    const providerType = config.has('llm.provider') ? config.get<string>('llm.provider') : 'ollama'

    if (providerType === 'openai') {
      _provider = new OpenAIProvider()
    } else {
      _provider = new OllamaProvider()
    }
  }
  return _provider
}

/**
 * Override the provider — useful in tests or for runtime switching.
 */
export function setProvider(provider: ILLMProvider): void {
  _provider = provider
}

/** Reset singleton (useful in tests between cases). */
export function resetProvider(): void {
  _provider = null
}
