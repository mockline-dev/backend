import config from 'config'
import type { LLMMessage, LLMStreamChunk } from './types'

export class OllamaClient {
  private baseUrl: string
  private model: string
  private embeddingModel: string
  private timeout: number
  private requestQueue: Array<() => void> = []
  private activeRequests = 0
  private readonly MAX_CONCURRENT_REQUESTS = 3

  constructor() {
    const ollamaConfig = config.get<{
      baseUrl: string
      model: string
      embeddingModel?: string
      timeout: number
    }>('ollama')
    this.baseUrl = ollamaConfig.baseUrl ?? 'http://localhost:11434'
    this.model = ollamaConfig.model
    // Make embedding model configurable via environment variable with a default fallback
    this.embeddingModel = ollamaConfig.embeddingModel ?? 'nomic-embed-text'
    this.timeout = ollamaConfig.timeout ?? 120000
  }

  private async acquireRequestSlot(): Promise<void> {
    if (this.activeRequests < this.MAX_CONCURRENT_REQUESTS) {
      this.activeRequests++
      return
    }

    return new Promise(resolve => {
      this.requestQueue.push(resolve)
    })
  }

  private releaseRequestSlot(): void {
    this.activeRequests--
    const next = this.requestQueue.shift()
    if (next) {
      next()
    }
  }

  async *chatStream(
    messages: LLMMessage[],
    tools?: object[],
    options: { temperature?: number; num_ctx?: number; num_predict?: number; top_p?: number } = {}
  ): AsyncGenerator<LLMStreamChunk> {
    // Acquire request slot to limit concurrent requests
    await this.acquireRequestSlot()

    const controller = new AbortController()
    const idleTimeout = this.timeout
    let timer: NodeJS.Timeout | undefined

    const refreshIdleTimer = () => {
      if (!idleTimeout || idleTimeout <= 0) {
        return
      }
      if (timer) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => controller.abort(), idleTimeout)
    }

    refreshIdleTimer()

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages,
          tools: tools || [],
          stream: true,
          options: {
            temperature: options.temperature ?? 0.15,
            num_ctx: options.num_ctx ?? 8192,
            num_predict: options.num_predict,
            top_p: options.top_p ?? 0.9,
            repeat_penalty: 1.1,
            stop: ['```\n\n```']
          }
        })
      })

      if (!response.ok) {
        const body = await response.text()
        throw new Error(`Ollama API error ${response.status}: ${body}`)
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()

      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        refreshIdleTimer()
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            yield JSON.parse(line) as LLMStreamChunk
          } catch {
            /* partial line — skip */
          }
        }
      }
      if (buffer.trim()) {
        try {
          yield JSON.parse(buffer) as LLMStreamChunk
        } catch {
          /* partial line — skip */
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error(
          `Ollama request aborted after ${idleTimeout}ms of inactivity. Increase ollama.timeout or use a faster model.`
        )
      }
      throw err
    } finally {
      if (timer) {
        clearTimeout(timer)
      }
      // Release request slot when done
      this.releaseRequestSlot()
    }
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.embeddingModel, prompt: text })
    })
    if (!res.ok) throw new Error(`Embed error: ${res.statusText}`)
    return (await res.json()).embedding
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
      return res.ok
    } catch {
      return false
    }
  }
}

export const ollamaClient = new OllamaClient()
