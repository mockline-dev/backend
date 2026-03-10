import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { r2Client } from '../r2.client'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('R2Client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('putObject', () => {
    it('should upload content to R2', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200
      } as Response)

      await r2Client.putObject('test-key', 'test content')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('.r2.cloudflarestorage.com'),
        expect.objectContaining({
          method: 'PUT',
          body: expect.any(Buffer),
          headers: expect.objectContaining({
            'x-amz-content-sha256': expect.any(String),
            'Content-Type': expect.any(String)
          })
        })
      )
    })

    it('should retry on failure', async () => {
      let attemptCount = 0
      mockFetch.mockRejectedValueOnce(new Error('Network error'))
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const startTime = Date.now()
      await r2Client.putObject('test-key', 'test content')

      // Should complete within timeout with retries
      expect(attemptCount).toBe(3)
      expect(Date.now() - startTime).toBeLessThan(125000)
    })

    it('should timeout after configured duration', async () => {
      const abortController = new AbortController()
      mockFetch.mockImplementationOnce(() => {
        return new Promise(() => {})
      })

      const startTime = Date.now()
      await r2Client.putObject('test-key', 'test content')

      // Should complete within timeout
      expect(Date.now() - startTime).toBeLessThan(125000)
      expect(abortController.signal.aborted).toBe(true)
    })
  })

  describe('getObject', () => {
    it('should download content from R2', async () => {
      const mockContent = 'Downloaded content'
      const mockStream = {
        getReader: () => ({
          read: async () => {
            return { done: false, value: mockContent }
          }
        })
      }

      mockFetch.mockResolvedValue({
        ok: true,
        body: mockStream
      } as unknown as Response)

      const result = await r2Client.getObject('test-key')

      expect(result).toBe(mockContent)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('.r2.cloudflarestorage.com'),
        expect.objectContaining({
          method: 'GET'
        })
      )
    })
  })

  describe('deleteObject', () => {
    it('should delete object from R2', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204
      } as Response)

      await r2Client.deleteObject('test-key')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('.r2.cloudflarestorage.com'),
        expect.objectContaining({
          method: 'DELETE'
        })
      )
    })
  })

  describe('listObjects', () => {
    it('should list objects with pagination', async () => {
      const mockObjects = [
        { Key: 'test/file1.txt', Size: 100, LastModified: new Date('2024-01-01T00:00:00.000Z') },
        { Key: 'test/file2.txt', Size: 200, LastModified: new Date('2024-01-01T00:00.00.000Z') },
        { Key: 'test/subdir/file3.txt', Size: 150, LastModified: new Date('2024-01-01T00:00.00.000Z') }
      ]

      const mockResponse = {
        Contents: mockObjects,
        NextContinuationToken: 'next-token-123'
      }

      mockFetch.mockResolvedValueOnce(mockResponse)
      mockFetch.mockResolvedValueOnce({ Contents: [], NextContinuationToken: undefined })

      const result = await r2Client.listObjects('test/')

      expect(result).toHaveLength(3)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('copyPrefix', () => {
    it('should copy all objects from source to dest prefix', async () => {
      const mockObjects = [
        { Key: 'source/file1.txt', Size: 100 },
        { Key: 'source/file2.txt', Size: 200 }
      ]

      const mockStream = {
        getReader: () => ({
          read: async () => {
            return { done: false, value: 'Content 1' }
          }
        })
      }

      // First call returns source objects
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockStream
      } as unknown as Response)

      // Second call copies each object
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: 'Content 2'
      } as unknown as Response)

      await r2Client.copyPrefix('source/', 'dest/')

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    describe('deletePrefix', () => {
      it('should delete all objects under a prefix', async () => {
        const mockObjects = [
          { Key: 'prefix/file1.txt', Size: 100 },
          { Key: 'prefix/file2.txt', Size: 200 }
        ]

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 204
        } as Response)

        await r2Client.deletePrefix('prefix/')

        expect(mockFetch).toHaveBeenCalledTimes(2)
      })
    })

    describe('exists', () => {
      it('should return true when object exists', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200
        } as Response)

        const result = await r2Client.exists('test-key')

        expect(result).toBe(true)
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('.r2.cloudflarestorage.com'),
          expect.objectContaining({
            method: 'HEAD'
          })
        )
      })

      it('should return false when object does not exist', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Not found'))

        const result = await r2Client.exists('test-key')

        expect(result).toBe(false)
      })
    })
  })
})
