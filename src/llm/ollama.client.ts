import config from 'config'

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: OllamaToolCall[]
  tool_call_id?: string
  name?: string
}

export interface OllamaToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface OllamaStreamChunk {
  message: {
    role: string
    content: string
    tool_calls?: OllamaToolCall[]
  }
  done: boolean
  eval_count?: number
  prompt_eval_count?: number
}

export class OllamaClient {
  private baseUrl: string
  private model: string
  private timeout: number

  constructor() {
    const ollamaConfig = config.get<{ baseUrl: string; model: string; timeout: number }>('ollama')
    this.baseUrl = ollamaConfig.baseUrl ?? 'http://localhost:11434'
    this.model = ollamaConfig.model
    this.timeout = ollamaConfig.timeout ?? 120000
  }

  async *chatStream(
    messages: OllamaMessage[],
    tools?: object[],
    options: { temperature?: number; num_ctx?: number; top_p?: number } = {}
  ): AsyncGenerator<OllamaStreamChunk> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

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

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        for (const line of text.split('\n').filter(l => l.trim())) {
          try {
            yield JSON.parse(line) as OllamaStreamChunk
          } catch {
            /* partial line — skip */
          }
        }
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', prompt: text })
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
