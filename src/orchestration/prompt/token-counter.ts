import { encode } from 'gpt-tokenizer'
import type { LLMMessage } from '../types'

// Simple LRU cache for token counts
const cache = new Map<string, number>()
const MAX_CACHE = 200

function cacheGet(key: string): number | undefined {
  const val = cache.get(key)
  if (val !== undefined) {
    // Refresh position
    cache.delete(key)
    cache.set(key, val)
  }
  return val
}

function cacheSet(key: string, val: number) {
  if (cache.size >= MAX_CACHE) {
    cache.delete(cache.keys().next().value as string)
  }
  cache.set(key, val)
}

/**
 * Count tokens in a string using GPT-4 tokenizer.
 * Approximate but consistent across providers.
 */
export function countTokens(text: string): number {
  const cached = cacheGet(text.slice(0, 128))
  if (cached !== undefined && text.length <= 128) return cached

  const count = encode(text).length
  if (text.length <= 128) cacheSet(text.slice(0, 128), count)
  return count
}

/**
 * Count tokens across a list of messages, including per-message overhead (~4 tokens each).
 */
export function countMessages(messages: LLMMessage[]): number {
  return messages.reduce((sum, msg) => sum + countTokens(msg.content) + 4, 0)
}
