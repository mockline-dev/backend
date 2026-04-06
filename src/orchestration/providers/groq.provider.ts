import Groq from 'groq-sdk'
import { createModuleLogger } from '../../logging'
import { ProviderTimeoutError, RateLimitError } from '../types'
import type { ILLMProvider, LLMCallOptions, LLMMessage, LLMResponse, LLMStreamChunk } from '../types'

const log = createModuleLogger('groq-provider')

export interface GroqProviderConfig {
  apiKey: string
  defaultModel: string
}

export class GroqProvider implements ILLMProvider {
  readonly name = 'groq'
  private client: Groq
  private defaultModel: string

  constructor(config: GroqProviderConfig) {
    this.client = new Groq({ apiKey: config.apiKey })
    this.defaultModel = config.defaultModel
  }

  async chat(messages: LLMMessage[], opts: LLMCallOptions = {}): Promise<LLMResponse> {
    const model = opts.model ?? this.defaultModel
    const timeoutMs = opts.timeoutMs ?? 60_000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await this.client.chat.completions.create(
        {
          model,
          messages: messages as Groq.Chat.Completions.ChatCompletionMessageParam[],
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.maxTokens,
          response_format: opts.json ? { type: 'json_object' } : undefined
        },
        { signal: controller.signal }
      )

      const choice = response.choices[0]
      return {
        content: choice.message.content ?? '',
        model: response.model,
        provider: this.name,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0
        },
        finishReason: choice.finish_reason ?? 'stop'
      }
    } catch (err: unknown) {
      this.handleError(err, timeoutMs)
    } finally {
      clearTimeout(timer)
    }
  }

  async *chatStream(messages: LLMMessage[], opts: LLMCallOptions = {}): AsyncIterable<LLMStreamChunk> {
    const model = opts.model ?? this.defaultModel
    const timeoutMs = opts.timeoutMs ?? 60_000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const stream = await this.client.chat.completions.create(
        {
          model,
          messages: messages as Groq.Chat.Completions.ChatCompletionMessageParam[],
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.maxTokens,
          stream: true
        },
        { signal: controller.signal }
      )

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? ''
        const done = chunk.choices[0]?.finish_reason != null
        yield { content: delta, done }
        if (done) break
      }
    } catch (err: unknown) {
      this.handleError(err, timeoutMs)
    } finally {
      clearTimeout(timer)
    }
  }

  private handleError(err: unknown, timeoutMs: number): never {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ProviderTimeoutError(this.name, timeoutMs)
    }
    if (err instanceof Groq.APIError && err.status === 429) {
      log.warn('Groq rate limited', { status: err.status })
      throw new RateLimitError(this.name, err.message)
    }
    if (err instanceof Groq.APIError && err.status >= 500) {
      log.error('Groq server error', { status: err.status, message: err.message })
    }
    throw err
  }
}
