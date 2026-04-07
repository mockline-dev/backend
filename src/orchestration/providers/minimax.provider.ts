import { createModuleLogger } from '../../logging'
import { ProviderTimeoutError, RateLimitError } from '../types'
import type { ILLMProvider, LLMCallOptions, LLMMessage, LLMResponse, LLMStreamChunk } from '../types'

const log = createModuleLogger('minimax-provider')

export interface MinimaxProviderConfig {
  apiKey: string
  baseUrl: string
  defaultModel: string
}

export class MinimaxProvider implements ILLMProvider {
  readonly name = 'minimax'
  private config: MinimaxProviderConfig

  constructor(config: MinimaxProviderConfig) {
    this.config = config
  }

  async chat(messages: LLMMessage[], opts: LLMCallOptions = {}): Promise<LLMResponse> {
    const model = opts.model ?? this.config.defaultModel
    const timeoutMs = opts.timeoutMs ?? 60_000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.maxTokens,
          response_format: opts.json ? { type: 'json_object' } : undefined
        }),
        signal: controller.signal
      })

      if (res.status === 429) throw new RateLimitError(this.name)
      if (res.status >= 500) {
        log.error('MiniMax server error', { status: res.status })
        throw new Error(`MiniMax server error: ${res.status}`)
      }
      if (!res.ok) throw new Error(`MiniMax error: ${res.status}`)

      const data = (await res.json()) as any
      const choice = data.choices[0]
      return {
        content: choice.message.content ?? '',
        model: data.model ?? model,
        provider: this.name,
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0
        },
        finishReason: choice.finish_reason ?? 'stop'
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ProviderTimeoutError(this.name, timeoutMs)
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  async *chatStream(messages: LLMMessage[], opts: LLMCallOptions = {}): AsyncIterable<LLMStreamChunk> {
    const model = opts.model ?? this.config.defaultModel
    const timeoutMs = opts.timeoutMs ?? 60_000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.maxTokens,
          stream: true
        }),
        signal: controller.signal
      })

      if (res.status === 429) throw new RateLimitError(this.name)
      if (res.status >= 500) throw new Error(`MiniMax server error: ${res.status}`)
      if (!res.ok) throw new Error(`MiniMax error: ${res.status}`)

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const json = trimmed.slice(5).trim()
          if (json === '[DONE]') return

          try {
            const chunk = JSON.parse(json)
            const delta = chunk.choices[0]?.delta?.content ?? ''
            const isDone = chunk.choices[0]?.finish_reason != null
            if (isDone) {
              const rawUsage = chunk.usage
              yield {
                content: delta,
                done: true,
                model: chunk.model ?? this.config.defaultModel,
                provider: this.name,
                usage: rawUsage
                  ? { promptTokens: rawUsage.prompt_tokens, completionTokens: rawUsage.completion_tokens, totalTokens: rawUsage.total_tokens }
                  : undefined
              }
              return
            }
            yield { content: delta, done: false }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ProviderTimeoutError(this.name, timeoutMs)
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }
}
