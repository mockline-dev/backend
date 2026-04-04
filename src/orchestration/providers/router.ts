import { createModuleLogger } from '../../logging'
import {
  AllProvidersFailedError,
  ProviderTimeoutError,
  RateLimitError,
} from '../types'
import type {
  ILLMProvider,
  LLMCallOptions,
  LLMMessage,
  LLMResponse,
  LLMStreamChunk,
} from '../types'
import { GroqProvider } from './groq.provider'
import { MinimaxProvider } from './minimax.provider'

const log = createModuleLogger('llm-router')

/**
 * Routes LLM calls to a primary provider with automatic fallback.
 * Falls back on: RateLimitError, ProviderTimeoutError, or any provider 5xx-class error.
 */
export class LLMRouter implements ILLMProvider {
  readonly name = 'router'

  constructor(
    private primary: ILLMProvider,
    private fallbacks: ILLMProvider[]
  ) {}

  async chat(messages: LLMMessage[], opts: LLMCallOptions = {}): Promise<LLMResponse> {
    const providers = [this.primary, ...this.fallbacks]
    const errors: Error[] = []

    for (const provider of providers) {
      try {
        log.debug(`Trying provider: ${provider.name}`)
        const result = await provider.chat(messages, opts)
        if (provider !== this.primary) {
          log.info(`Fallback succeeded via ${provider.name}`)
        }
        return result
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err))
        errors.push(error)
        if (this.shouldFallback(error)) {
          log.warn(`Provider ${provider.name} failed, trying next`, {
            error: error.message,
            provider: provider.name,
          })
          continue
        }
        // Non-retriable error — rethrow immediately
        throw err
      }
    }

    throw new AllProvidersFailedError(errors)
  }

  async *chatStream(
    messages: LLMMessage[],
    opts: LLMCallOptions = {}
  ): AsyncIterable<LLMStreamChunk> {
    const providers = [this.primary, ...this.fallbacks]
    const errors: Error[] = []

    for (const provider of providers) {
      try {
        log.debug(`Trying provider (stream): ${provider.name}`)
        yield* provider.chatStream(messages, opts)
        return
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err))
        errors.push(error)
        if (this.shouldFallback(error)) {
          log.warn(`Provider ${provider.name} failed on stream, trying next`, {
            error: error.message,
            provider: provider.name,
          })
          continue
        }
        throw err
      }
    }

    throw new AllProvidersFailedError(errors)
  }

  private shouldFallback(err: Error): boolean {
    return err instanceof RateLimitError || err instanceof ProviderTimeoutError
  }
}

/**
 * Factory — reads config from FeathersJS app and returns a ready LLMRouter.
 */
export function createRouter(app: { get: (key: string) => any }): LLMRouter {
  const llmConfig = app.get('llm')

  const groq = new GroqProvider({
    apiKey: llmConfig.groq.apiKey,
    defaultModel: llmConfig.groq.defaultModel,
  })

  const minimax = new MinimaxProvider({
    apiKey: llmConfig.minimax.apiKey,
    baseUrl: llmConfig.minimax.baseUrl,
    defaultModel: llmConfig.minimax.defaultModel,
  })

  return new LLMRouter(groq, [minimax])
}
