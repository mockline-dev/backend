import config from 'config'

import { logger } from '../../logger'
import { OllamaProvider } from './ollama.provider'
import { OpenAIProvider } from './openai.provider'
import type { LLMProvider } from './types'

let cachedProvider: LLMProvider | null = null

export function getProvider(): LLMProvider {
  if (cachedProvider) {
    return cachedProvider
  }

  const providerName = config.has('llm.provider') ? config.get<string>('llm.provider') : 'ollama'

  if (providerName === 'openai') {
    const apiKey = config.get<string>('openai.apiKey')
    const model = config.get<string>('openai.model')
    if (!apiKey) {
      logger.warn('OpenAI provider selected but apiKey is empty, falling back to Ollama')
    } else {
      cachedProvider = new OpenAIProvider(apiKey, model)
      return cachedProvider
    }
  }

  const ollama = config.get<{
    baseUrl?: string
    model: string
  }>('ollama')

  cachedProvider = new OllamaProvider(ollama.baseUrl || 'http://localhost:11434', ollama.model)
  return cachedProvider
}

export function resetProviderCache() {
  cachedProvider = null
}
