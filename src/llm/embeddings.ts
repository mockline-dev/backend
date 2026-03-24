import { createHash } from 'crypto'
import { getProvider } from './providers/registry'

/**
 * Creates an embedding vector for the given text using the configured provider.
 * Uses in-memory caching to avoid re-embedding the same content.
 */
const cache = new Map<string, number[]>()

export async function embed(text: string): Promise<number[]> {
  const key = createHash('sha256').update(text).digest('hex')
  const cached = cache.get(key)
  if (cached) return cached

  const vector = await getProvider().embed(text)
  if (cache.size > 2000) {
    // Simple LRU eviction: clear oldest half
    const keys = [...cache.keys()]
    keys.slice(0, 1000).forEach(k => cache.delete(k))
  }
  cache.set(key, vector)
  return vector
}

/**
 * Cosine similarity between two vectors. Returns a value in [-1, 1].
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0,
    normA = 0,
    normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}
