import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ollamaClient } from '../ollama.client'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

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
        { message: { role: 'assistant', content: 'Hello', done: false } },
        { message: { role: 'assistant', content: ' World', done: true } }
      ]

      mockFetch.mockResolvedValue({
        ok: true,
        body: {
          getReader: () => {
            let index = 0
            return {
              read: async () => {
                if (index < mockChunks.length) {
                  return { done: false, value: mockChunks[index].message }
                }
                return { done: true, value: undefined }
              }
            }
          }
        }
      } as Response as any)

      const chunks: string[] = []
      for await (const chunk of ollamaClient.chatStream([{ role: 'user', content: 'test' }], undefined, {
        temperature: 0.1
      })) {
        chunks.push(chunk.message.content || '')
      }

      expect(chunks).toEqual(['Hello', 'World'])
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

    it('should handle fetch errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(
        ollamaClient.chatStream([{ role: 'user', content: 'test' }], undefined, { temperature: 0.1 })
      ).rejects.toThrow('Ollama API error 500: Network error')
    })

    it('should timeout after configured duration', async () => {
      const abortController = new AbortController()
      mockFetch.mockImplementationOnce(() => {
        return new Promise(() => {})
      })

      const startTime = Date.now()
      await ollamaClient.chatStream([{ role: 'user', content: 'test' }], undefined, { temperature: 0.1 })

      // Should complete within timeout (120s)
      expect(Date.now() - startTime).toBeLessThan(125000)
      expect(abortController.signal.aborted).toBe(true)
    })
  })

  describe('embed', () => {
    it('should generate embeddings', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: {
          getReader: () => {
            return {
              read: async () => {
                return {
                  done: true,
                  value: new TextEncoder().encode(JSON.stringify({ embedding: [0.1, 0.2, 0.3] }))
                }
              }
            }
          }
        }
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
  })

  describe('healthCheck', () => {
    it('should return true when Ollama is reachable', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200
      } as Response)

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

    it('should timeout health check after 3 seconds', async () => {
      mockFetch.mockImplementationOnce(() => {
        return new Promise(() => {})
      })

      const startTime = Date.now()
      await ollamaClient.healthCheck()

      // Should timeout after 3 seconds
      expect(Date.now() - startTime).toBeGreaterThanOrEqual(3000)
    })
  })
})
