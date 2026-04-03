import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted so it's available inside vi.mock factory
const mockSend = vi.hoisted(() => vi.fn())

vi.mock('@aws-sdk/client-s3', () => {
  class MockS3Client {
    send = mockSend
  }
  class PutObjectCommand { constructor(public input: unknown) {} }
  class GetObjectCommand { constructor(public input: unknown) {} }
  class DeleteObjectCommand { constructor(public input: unknown) {} }
  class ListObjectsV2Command { constructor(public input: unknown) {} }
  class HeadObjectCommand { constructor(public input: unknown) {} }
  class CopyObjectCommand { constructor(public input: unknown) {} }
  return {
    S3Client: MockS3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    HeadObjectCommand,
    CopyObjectCommand
  }
})

// Mock config
vi.mock('config', () => ({
  default: {
    get: vi.fn().mockReturnValue({
      bucket: 'test-bucket',
      region: 'auto',
      endpoint: 'https://test.r2.cloudflarestorage.com',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret'
    })
  }
}))

import { R2Client } from '../r2.client'

describe('R2Client', () => {
  let r2: R2Client

  beforeEach(() => {
    vi.clearAllMocks()
    r2 = new R2Client()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('putObject', () => {
    it('should upload content to R2', async () => {
      mockSend.mockResolvedValue({})

      await r2.putObject('test-key', 'test content')

      expect(mockSend).toHaveBeenCalledTimes(1)
    })

    it('should retry on failure then succeed', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network error'))
      mockSend.mockRejectedValueOnce(new Error('Network error'))
      mockSend.mockResolvedValue({})

      await r2.putObject('test-key', 'test content')

      expect(mockSend).toHaveBeenCalledTimes(3)
    })

    it('should throw after exhausting retries', async () => {
      mockSend.mockRejectedValue(new Error('Persistent error'))

      await expect(r2.putObject('test-key', 'test content')).rejects.toThrow('Persistent error')
      expect(mockSend).toHaveBeenCalledTimes(3)
    })
  })

  describe('getObject', () => {
    it('should download content from R2', async () => {
      const { Readable } = await import('stream')
      const stream = Readable.from([Buffer.from('Downloaded content')])

      mockSend.mockResolvedValue({ Body: stream })

      const result = await r2.getObject('test-key')

      expect(result).toBe('Downloaded content')
      expect(mockSend).toHaveBeenCalledTimes(1)
    })
  })

  describe('deleteObject', () => {
    it('should delete object from R2', async () => {
      mockSend.mockResolvedValue({})

      await r2.deleteObject('test-key')

      expect(mockSend).toHaveBeenCalledTimes(1)
    })
  })

  describe('listObjects', () => {
    it('should list objects with pagination', async () => {
      const page1 = {
        Contents: [
          { Key: 'test/file1.txt', Size: 100, LastModified: new Date('2024-01-01') },
          { Key: 'test/file2.txt', Size: 200, LastModified: new Date('2024-01-01') }
        ],
        NextContinuationToken: 'next-token'
      }
      const page2 = {
        Contents: [{ Key: 'test/file3.txt', Size: 150, LastModified: new Date('2024-01-01') }],
        NextContinuationToken: undefined
      }

      mockSend.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2)

      const result = await r2.listObjects('test/')

      expect(result).toHaveLength(3)
      expect(mockSend).toHaveBeenCalledTimes(2)
    })
  })

  describe('exists', () => {
    it('should return true when object exists', async () => {
      mockSend.mockResolvedValue({})

      const result = await r2.exists('test-key')

      expect(result).toBe(true)
      expect(mockSend).toHaveBeenCalledTimes(1)
    })

    it('should return false when object does not exist', async () => {
      mockSend.mockRejectedValueOnce(new Error('Not found'))

      const result = await r2.exists('test-key')

      expect(result).toBe(false)
    })
  })

  describe('copyPrefix', () => {
    it('should copy all objects from source to dest prefix', async () => {
      // listObjects returns 2 objects
      mockSend.mockResolvedValueOnce({
        Contents: [
          { Key: 'source/file1.txt', Size: 100, LastModified: new Date() },
          { Key: 'source/file2.txt', Size: 200, LastModified: new Date() }
        ],
        NextContinuationToken: undefined
      })
      // copyObject calls for each
      mockSend.mockResolvedValue({})

      await r2.copyPrefix('source/', 'dest/')

      // 1 list + 2 copy = 3 calls
      expect(mockSend).toHaveBeenCalledTimes(3)
    })

    it('should delete all objects under a prefix', async () => {
      mockSend.mockResolvedValueOnce({
        Contents: [
          { Key: 'prefix/file1.txt', Size: 100, LastModified: new Date() },
          { Key: 'prefix/file2.txt', Size: 200, LastModified: new Date() }
        ],
        NextContinuationToken: undefined
      })
      mockSend.mockResolvedValue({})

      await r2.deletePrefix('prefix/')

      // 1 list + 2 delete = 3 calls
      expect(mockSend).toHaveBeenCalledTimes(3)
    })
  })
})
