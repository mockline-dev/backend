import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ollamaClient } from '../ollama.client'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// ─── Helper ───────────────────────────────────────────────────────────────────

const encoder = new TextEncoder()

/** Encode an array of NDJSON objects as a streaming reader mock. */
function makeStreamReader(chunks: object[]): ReturnType<ReadableStream['getReader']> {
  const lines = chunks.map(c => encoder.encode(JSON.stringify(c) + '\n'))
  let index = 0
  return {
    read: async () => {
      if (index < lines.length) return { done: false as const, value: lines[index++] }
      return { done: true as const, value: undefined }
    },
    cancel: async () => {},
    releaseLock: () => {}
  } as unknown as ReturnType<ReadableStream['getReader']>
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OllamaClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('chatStream', () => {
    it('should stream chat chunks from Ollama', async () => {
      const mockChunks = [
        { message: { role: 'assistant', content: 'Hello' }, done: false },
        { message: { role: 'assistant', content: ' World' }, done: true }
      ]

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => makeStreamReader(mockChunks) }
      } as unknown as Response)

      const chunks: string[] = []
      for await (const chunk of ollamaClient.chatStream([{ role: 'user', content: 'test' }], undefined, {
        temperature: 0.1
      })) {
        chunks.push(chunk.message.content)
      }

      expect(chunks).toEqual(['Hello', ' World'])
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/chat'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('"model"')
        })
      )
    })

    it('should throw when Ollama returns a non-OK status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error'
      } as unknown as Response)

      await expect(async () => {
        for await (const _ of ollamaClient.chatStream(
          [{ role: 'user', content: 'test' }],
          undefined,
          { temperature: 0.1 }
        )) {
          // consume
        }
      }).rejects.toThrow('Ollama API error 500')
    })

    it('should throw when fetch rejects (network error)', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      await expect(async () => {
        for await (const _ of ollamaClient.chatStream(
          [{ role: 'user', content: 'test' }],
          undefined,
          { temperature: 0.1 }
        )) {
          // consume
        }
      }).rejects.toThrow('Network error')
    })
  })

  describe('embed', () => {
    it('should generate embeddings', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: [0.1, 0.2, 0.3] })
      } as unknown as Response)

      const result = await ollamaClient.embed('test text')

      expect(result).toEqual([0.1, 0.2, 0.3])
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/embeddings'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"prompt"')
        })
      )
    })

    it('should throw on embed API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => 'model not loaded'
      } as unknown as Response)

      await expect(ollamaClient.embed('test')).rejects.toThrow('Embed error:')
    })
  })

  describe('healthCheck', () => {
    it('should return true when Ollama is reachable', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response)

      const result = await ollamaClient.healthCheck()

      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/tags'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    })

    it('should return false when Ollama is not reachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'))

      const result = await ollamaClient.healthCheck()

      expect(result).toBe(false)
    })
  })
})
