import config from 'config'
import { Ollama } from 'ollama'

import { logger } from '../logger'
import { OllamaProvider } from './providers/ollama.provider'

type OllamaRole = 'planner' | 'generator' | 'fixer' | 'critic' | 'utility' | 'intent' | 'reflection'

class OllamaClient {
  private provider: OllamaProvider
  private client: Ollama
  private readonly baseUrl: string
  private readonly config: {
    model: string
    roleModels?: Partial<Record<OllamaRole, string>>
    fallbacks?: Partial<Record<OllamaRole, string[]>>
    autoPullMissing?: boolean
  }

  constructor() {
    const ollama = config.get<{
      baseUrl?: string
      model: string
      roleModels?: Partial<Record<OllamaRole, string>>
      fallbacks?: Partial<Record<OllamaRole, string[]>>
      autoPullMissing?: boolean
    }>('ollama')

    this.baseUrl = ollama.baseUrl || 'http://localhost:11434'
    this.config = ollama
    this.provider = new OllamaProvider(this.baseUrl, ollama.model)
    this.client = new Ollama({ host: this.baseUrl })
  }

  async healthCheck(): Promise<boolean> {
    return this.provider.healthCheck()
  }

  resolveRoleModel(role: OllamaRole): { primary: string; candidates: string[] } {
    const roleModels = this.config.roleModels || {}
    const fallbacks = this.config.fallbacks || {}

    const primary = roleModels[role] || this.config.model
    const candidates = [primary, ...(fallbacks[role] || []), this.config.model].filter(Boolean)

    return {
      primary,
      candidates: Array.from(new Set(candidates))
    }
  }

  async ensureModelAvailable(primary: string, fallbackCandidates: string[] = []): Promise<string> {
    const candidates = Array.from(new Set([primary, ...fallbackCandidates].filter(Boolean)))

    if (candidates.length === 0) {
      throw new Error('No Ollama model candidates provided')
    }

    const installed = await this.getInstalledModels()
    const installedSet = new Set(installed)

    for (const candidate of candidates) {
      if (installedSet.has(candidate)) {
        return candidate
      }
    }

    if (this.config.autoPullMissing === false) {
      return primary
    }

    for (const candidate of candidates) {
      try {
        logger.info('Ollama pull started for model=%s', candidate)
        await this.client.pull({ model: candidate, stream: false })
        logger.info('Ollama pull completed for model=%s', candidate)
        return candidate
      } catch (error: any) {
        logger.warn('Failed pulling Ollama model %s: %s', candidate, error?.message || 'unknown error')
      }
    }

    throw new Error(`Unable to resolve any Ollama model from candidates: ${candidates.join(', ')}`)
  }

  async ensureRoleModelsAvailable(
    roles: OllamaRole[] = ['planner', 'generator', 'fixer', 'critic', 'utility']
  ) {
    for (const role of roles) {
      const resolved = this.resolveRoleModel(role)
      await this.ensureModelAvailable(resolved.primary, resolved.candidates)
    }
  }

  private async getInstalledModels(): Promise<string[]> {
    try {
      const list = await this.client.list()
      return (list.models || []).map(item => item.model).filter(Boolean)
    } catch (error: any) {
      logger.warn('Unable to list Ollama models: %s', error?.message || 'unknown error')
      return []
    }
  }
}

export const ollamaClient = new OllamaClient()
