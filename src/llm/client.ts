import config from 'config'

import { logger } from '../logger'

// ─── Message types ────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ChatToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatResponse {
  content: string
  tool_calls?: ChatToolCall[]
}

export interface ChatOptions {
  model?: string
  messages: ChatMessage[]
  temperature?: number
  format?: 'json'
  tools?: object[]
  /** Prepend /think (true) or /nothink (false) to the first user message. */
  think?: boolean
}

export interface OllamaModel {
  name: string
  size: number
  digest: string
}

// ─── Model config ─────────────────────────────────────────────────────────────

export interface ModelConfig {
  name: string
  temperature: number
  think: boolean
  toolCalling?: boolean
  timeout: number
}

export type ModelPhase = 'planning' | 'generation' | 'fixing' | 'editing' | 'conversation'

/** Returns the model config for the given phase, falling back to defaults if config missing. */
export function getModelConfig(phase: ModelPhase): ModelConfig {
  try {
    return config.get<ModelConfig>(`models.${phase}`)
  } catch {
    const name = config.get<string>('ollama.model')
    return { name, temperature: 0.3, think: false, timeout: 120_000 }
  }
}

// ─── Config shape ─────────────────────────────────────────────────────────────

interface OllamaConfig {
  baseUrl: string
  model: string
  embedModel: string
  timeout: number
  numCtx: number
  topP: number
  repeatPenalty: number
}

// ─── Timeout helper ───────────────────────────────────────────────────────────
// p-timeout v7 is ESM-only, incompatible with this CJS project.
// This helper provides the same semantics: rejects with a clear message after ms.

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    timeout
  ])
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class OllamaClient {
  private readonly baseUrl: string
  private readonly defaultModel: string
  private readonly embedModel: string
  private readonly timeout: number
  private readonly numCtx: number
  private readonly topP: number
  private readonly repeatPenalty: number

  constructor() {
    const cfg = config.get<OllamaConfig>('ollama')
    this.baseUrl = cfg.baseUrl ?? 'http://localhost:11434'
    this.defaultModel = cfg.model
    this.embedModel = cfg.embedModel ?? 'nomic-embed-text'
    this.timeout = cfg.timeout ?? 60_000
    this.numCtx = cfg.numCtx ?? 32_768
    this.topP = cfg.topP ?? 0.9
    this.repeatPenalty = cfg.repeatPenalty ?? 1.1
  }

  // ── Non-streaming chat ────────────────────────────────────────────────────

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const { model, messages, temperature, format, tools, think } = options
    const processedMessages = this.applyThinkPrefix(messages, think)

    const body: Record<string, unknown> = {
      model: model ?? this.defaultModel,
      messages: processedMessages,
      stream: false,
      options: {
        temperature: temperature ?? 0.3,
        num_ctx: this.numCtx,
        top_p: this.topP,
        repeat_penalty: this.repeatPenalty
      }
    }
    if (format) body.format = format
    if (tools && tools.length > 0) body.tools = tools

    const fetchPromise = this.doFetch<{
      message: { content: string; tool_calls?: ChatToolCall[] }
    }>(`${this.baseUrl}/api/chat`, 'POST', body)

    const result = await withTimeout(
      fetchPromise,
      this.timeout,
      `Ollama chat timed out after ${this.timeout}ms`
    )

    return {
      content: result.message.content ?? '',
      tool_calls: result.message.tool_calls
    }
  }

  // ── Streaming chat ────────────────────────────────────────────────────────

  async *chatStream(
    options: ChatOptions
  ): AsyncGenerator<{ content: string; tool_calls?: ChatToolCall[]; done: boolean }> {
    const { model, messages, temperature, format, tools, think } = options
    const processedMessages = this.applyThinkPrefix(messages, think)

    const body: Record<string, unknown> = {
      model: model ?? this.defaultModel,
      messages: processedMessages,
      stream: true,
      options: {
        temperature: temperature ?? 0.3,
        num_ctx: this.numCtx,
        top_p: this.topP,
        repeat_penalty: this.repeatPenalty
      }
    }
    if (format) body.format = format
    if (tools && tools.length > 0) body.tools = tools

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Ollama API error ${response.status}: ${text}`)
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        for (const line of text.split('\n').filter(l => l.trim())) {
          try {
            const chunk = JSON.parse(line) as {
              message?: { content?: string; tool_calls?: ChatToolCall[] }
              done: boolean
            }
            yield {
              content: chunk.message?.content ?? '',
              tool_calls: chunk.message?.tool_calls,
              done: chunk.done
            }
          } catch {
            // partial line — skip
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Ollama stream timed out after ${this.timeout}ms`)
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  // ── Embeddings ────────────────────────────────────────────────────────────

  async embed(text: string): Promise<number[]> {
    const fetchPromise = this.doFetch<{ embedding: number[] }>(
      `${this.baseUrl}/api/embeddings`,
      'POST',
      { model: this.embedModel, prompt: text }
    )

    const result = await withTimeout(fetchPromise, 30_000, 'Ollama embed timed out after 30s')
    return result.embedding
  }

  // ── Model warm-up ─────────────────────────────────────────────────────────

  /**
   * Pre-loads a model into GPU memory by sending a minimal request.
   * Ollama swaps models on 16GB machines — call this before batch operations
   * to absorb the 2-3s swap time upfront.
   */
  async warmModel(modelName: string): Promise<void> {
    logger.debug('OllamaClient.warmModel: warming "%s"', modelName)
    try {
      await withTimeout(
        this.doFetch<unknown>(`${this.baseUrl}/api/generate`, 'POST', {
          model: modelName,
          prompt: '',
          keep_alive: '5m'
        }),
        30_000,
        `warmModel timed out for ${modelName}`
      )
      logger.debug('OllamaClient.warmModel: "%s" ready', modelName)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('OllamaClient.warmModel: "%s" warm-up failed (non-fatal): %s', modelName, msg)
    }
  }

  /**
   * Checks if a model is currently loaded in Ollama via /api/ps.
   * Returns false if the endpoint is unavailable or the model is not loaded.
   */
  async isModelReady(modelName: string): Promise<boolean> {
    try {
      const result = await withTimeout(
        this.doFetch<{ models?: Array<{ name: string }> }>(`${this.baseUrl}/api/ps`, 'GET'),
        5_000,
        'isModelReady timed out'
      )
      const loaded = result.models ?? []
      return loaded.some(m => m.name === modelName || m.name.startsWith(modelName.split(':')[0]))
    } catch {
      return false
    }
  }

  // ── Model list ────────────────────────────────────────────────────────────

  async listModels(): Promise<OllamaModel[]> {
    try {
      const fetchPromise = this.doFetch<{ models: OllamaModel[] }>(
        `${this.baseUrl}/api/tags`,
        'GET'
      )
      const result = await withTimeout(fetchPromise, 5_000, 'Ollama listModels timed out')
      return result.models ?? []
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('OllamaClient.listModels failed: %s', msg)
      return []
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async doFetch<T>(url: string, method: string, body?: unknown): Promise<T> {
    const init: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' }
    }
    if (body !== undefined) init.body = JSON.stringify(body)

    const res = await fetch(url, init)
    if (!res.ok) {
      const text = await res.text()
      if (res.status === 404) {
        throw new Error(`Ollama model not found: ${text}`)
      }
      throw new Error(`Ollama API error ${res.status}: ${text}`)
    }
    return res.json() as Promise<T>
  }

  private applyThinkPrefix(messages: ChatMessage[], think?: boolean): ChatMessage[] {
    if (think === undefined) return messages
    const prefix = think ? '/think' : '/nothink'
    const result = [...messages]
    const firstUserIdx = result.findIndex(m => m.role === 'user')
    if (firstUserIdx >= 0) {
      result[firstUserIdx] = {
        ...result[firstUserIdx],
        content: `${prefix}\n\n${result[firstUserIdx].content}`
      }
    }
    return result
  }
}

/** Singleton for convenience — most callers should use this. */
export const llmClient = new OllamaClient()
