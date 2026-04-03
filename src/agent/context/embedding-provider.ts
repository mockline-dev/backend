import config from 'config'

import { logger } from '../../logger'

// ─── Config ───────────────────────────────────────────────────────────────────

interface OllamaConfig {
  baseUrl: string
  embedModel: string
}

// ─── OllamaEmbeddingFunction ──────────────────────────────────────────────────

/**
 * ChromaDB-compatible embedding function backed by Ollama's /api/embed endpoint.
 *
 * Implements ChromaDB's expected `{ generate(texts): Promise<number[][]> }` interface.
 * Falls back to per-text /api/embeddings when batch endpoint returns 404.
 * On per-text failure: retries once, then returns zero-vector of dimension 768.
 */
export class OllamaEmbeddingFunction {
  private readonly baseUrl: string
  private readonly model: string

  constructor(opts?: { baseUrl?: string; model?: string }) {
    const cfg = config.get<OllamaConfig>('ollama')
    this.baseUrl = opts?.baseUrl ?? cfg.baseUrl
    this.model = opts?.model ?? cfg.embedModel
  }

  async generate(texts: string[]): Promise<number[][]> {
    try {
      return await this.batchEmbed(texts)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('404')) {
        logger.debug('OllamaEmbeddingFunction: /api/embed not available, falling back to per-text')
        return this.perTextEmbed(texts)
      }
      logger.warn('OllamaEmbeddingFunction: batch embed failed (%s), falling back to per-text', msg)
      return this.perTextEmbed(texts)
    }
  }

  private async batchEmbed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(30_000)
    })

    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`)
    }

    const data = (await res.json()) as { embeddings: number[][] }
    return data.embeddings
  }

  private async perTextEmbed(texts: string[]): Promise<number[][]> {
    const results: number[][] = []
    for (const text of texts) {
      let embedding: number[]
      try {
        embedding = await this.embedSingle(text)
      } catch {
        try {
          embedding = await this.embedSingle(text)
        } catch {
          embedding = new Array(768).fill(0) as number[]
        }
      }
      results.push(embedding)
    }
    return results
  }

  private async embedSingle(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
      signal: AbortSignal.timeout(30_000)
    })

    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`)
    }

    const data = (await res.json()) as { embedding: number[] }
    return data.embedding
  }
}

export const ollamaEmbedFn = new OllamaEmbeddingFunction()
