import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LLMRouter } from '../router'
import { RateLimitError, ProviderTimeoutError, AllProvidersFailedError } from '../../types'
import type { ILLMProvider, LLMMessage, LLMResponse, LLMStreamChunk } from '../../types'

function mockProvider(name: string, response?: Partial<LLMResponse>): ILLMProvider {
  return {
    name,
    chat: vi.fn().mockResolvedValue({
      content: 'mock response',
      model: 'mock-model',
      provider: name,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      finishReason: 'stop',
      ...response,
    }),
    chatStream: vi.fn().mockImplementation(async function* () {
      yield { content: 'mock', done: false }
      yield { content: ' stream', done: true }
    }),
  }
}

function failingProvider(name: string, error: Error): ILLMProvider {
  return {
    name,
    chat: vi.fn().mockRejectedValue(error),
    chatStream: vi.fn().mockImplementation(async function* () {
      throw error
    }),
  }
}

const MESSAGES: LLMMessage[] = [{ role: 'user', content: 'hello' }]

describe('LLMRouter', () => {
  it('returns primary provider response on success', async () => {
    const primary = mockProvider('groq')
    const router = new LLMRouter(primary, [])
    const result = await router.chat(MESSAGES)
    expect(result.provider).toBe('groq')
    expect(result.content).toBe('mock response')
    expect(primary.chat).toHaveBeenCalledOnce()
  })

  it('falls back on RateLimitError', async () => {
    const primary = failingProvider('groq', new RateLimitError('groq'))
    const fallback = mockProvider('minimax')
    const router = new LLMRouter(primary, [fallback])
    const result = await router.chat(MESSAGES)
    expect(result.provider).toBe('minimax')
    expect(fallback.chat).toHaveBeenCalledOnce()
  })

  it('falls back on ProviderTimeoutError', async () => {
    const primary = failingProvider('groq', new ProviderTimeoutError('groq', 5000))
    const fallback = mockProvider('minimax')
    const router = new LLMRouter(primary, [fallback])
    const result = await router.chat(MESSAGES)
    expect(result.provider).toBe('minimax')
  })

  it('throws AllProvidersFailedError when all fail', async () => {
    const primary = failingProvider('groq', new RateLimitError('groq'))
    const fallback = failingProvider('minimax', new RateLimitError('minimax'))
    const router = new LLMRouter(primary, [fallback])
    await expect(router.chat(MESSAGES)).rejects.toThrow(AllProvidersFailedError)
  })

  it('does not fall back on non-retriable errors', async () => {
    const primary = failingProvider('groq', new Error('unexpected internal error'))
    const fallback = mockProvider('minimax')
    const router = new LLMRouter(primary, [fallback])
    await expect(router.chat(MESSAGES)).rejects.toThrow('unexpected internal error')
    expect(fallback.chat).not.toHaveBeenCalled()
  })

  it('only tries primary when no fallbacks configured', async () => {
    const primary = mockProvider('groq', { content: 'solo response' })
    const router = new LLMRouter(primary, [])
    const result = await router.chat(MESSAGES)
    expect(result.content).toBe('solo response')
  })

  it('streams from primary on success', async () => {
    const primary = mockProvider('groq')
    const router = new LLMRouter(primary, [])
    const chunks: LLMStreamChunk[] = []
    for await (const chunk of router.chatStream(MESSAGES)) {
      chunks.push(chunk)
    }
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.some((c) => c.content.length > 0)).toBe(true)
  })

  it('falls back stream on RateLimitError', async () => {
    const primary = failingProvider('groq', new RateLimitError('groq'))
    const fallback = mockProvider('minimax')
    const router = new LLMRouter(primary, [fallback])
    const chunks: LLMStreamChunk[] = []
    for await (const chunk of router.chatStream(MESSAGES)) {
      chunks.push(chunk)
    }
    expect(fallback.chatStream).toHaveBeenCalled()
    expect(chunks.length).toBeGreaterThan(0)
  })

  it('passes options to the provider', async () => {
    const primary = mockProvider('groq')
    const router = new LLMRouter(primary, [])
    await router.chat(MESSAGES, { temperature: 0.2, maxTokens: 100 })
    expect(primary.chat).toHaveBeenCalledWith(MESSAGES, { temperature: 0.2, maxTokens: 100 })
  })
})
