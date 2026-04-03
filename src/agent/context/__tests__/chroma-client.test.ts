import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'
import type { MocklineChromaClient } from '../chroma-client'

// ─── Mock chromadb module ─────────────────────────────────────────────────────

const mockDelete = vi.fn().mockResolvedValue(undefined)
const mockUpsert = vi.fn().mockResolvedValue(undefined)
const mockQuery = vi.fn().mockResolvedValue({
  ids: [[]],
  documents: [[]],
  distances: [[]],
  metadatas: [[]]
})

const mockGetOrCreateCollection = vi.fn().mockResolvedValue({
  upsert: mockUpsert,
  query: mockQuery,
  delete: mockDelete,
})

const mockHeartbeat = vi.fn().mockResolvedValue(1)
const mockDeleteCollection = vi.fn().mockResolvedValue(undefined)

class MockChromaBaseClient {
  heartbeat = mockHeartbeat
  getOrCreateCollection = mockGetOrCreateCollection
  deleteCollection = mockDeleteCollection
}

vi.mock('chromadb', () => ({ ChromaClient: MockChromaBaseClient }))

// ─── Mock config ──────────────────────────────────────────────────────────────

vi.mock('config', () => ({
  default: {
    get: (key: string) => {
      const cfg: Record<string, unknown> = {
        chromadb: { host: 'localhost', port: 8001, collection: 'test' },
        ollama: { baseUrl: 'http://localhost:11434', embedModel: 'nomic-embed-text' }
      }
      return cfg[key]
    }
  }
}))

// ─── Mock logger ──────────────────────────────────────────────────────────────

vi.mock('../../../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

// ─── Mock OllamaEmbeddingFunction ─────────────────────────────────────────────

vi.mock('../embedding-provider', () => ({
  OllamaEmbeddingFunction: class {
    generate(texts: string[]) {
      return Promise.resolve(texts.map(() => new Array(768).fill(0.1) as number[]))
    }
  },
  ollamaEmbedFn: {
    generate: vi.fn().mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map(() => new Array(768).fill(0.1) as number[]))
    )
  }
}))

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MocklineChromaClient', () => {
  let client: MocklineChromaClient

  beforeEach(async () => {
    vi.clearAllMocks()
    // Re-import to get a fresh instance with cleared state
    const mod = await import('../chroma-client')
    // Create fresh instance for each test
    const { MocklineChromaClient: Cls } = mod
    client = new Cls()
  })

  it('isAvailable() returns true before any failure', () => {
    expect(client.isAvailable()).toBe(true)
  })

  it('isAvailable() returns false after connection failure within cooldown', async () => {
    mockHeartbeat.mockRejectedValueOnce(new Error('connection refused'))
    const result = await client.ping()
    expect(result).toBe(false)
    expect(client.isAvailable()).toBe(false)
  })

  it('search() returns empty array when unavailable', async () => {
    mockHeartbeat.mockRejectedValueOnce(new Error('down'))
    // force failure
    await client.ping()

    const results = await client.search('proj1', 'query', 5)
    expect(results).toEqual([])
  })

  it('indexProject() calls upsert with correct chunk structure', async () => {
    const files = [
      { path: 'app/main.py', content: 'def hello():\n    return "world"', source: 'llm' as const, validated: true }
    ]

    await client.indexProject('proj1', files)

    expect(mockUpsert).toHaveBeenCalled()
    const call = mockUpsert.mock.calls[0][0] as {
      ids: string[]
      embeddings: number[][]
      documents: string[]
      metadatas: Array<Record<string, unknown>>
    }
    expect(call.ids.length).toBeGreaterThan(0)
    expect(call.embeddings.length).toBe(call.ids.length)
    expect(call.documents.length).toBe(call.ids.length)
    expect(call.metadatas[0]).toHaveProperty('filepath', 'app/main.py')
  })

  it('indexFile() deletes old chunks then upserts new ones', async () => {
    // First ensure client is connected
    await client.ping()

    // Mock query to return some existing ids for deletion
    mockQuery.mockResolvedValueOnce({
      ids: [['app/utils.py::1']],
      documents: [['old content']],
      distances: [[0.1]],
      metadatas: [[{ filepath: 'app/utils.py', startLine: 1, endLine: 5 }]]
    })

    await client.indexFile('proj1', 'app/utils.py', 'def helper(value: str) -> str:\n    return value.strip()')

    expect(mockDelete).toHaveBeenCalledWith({ ids: ['app/utils.py::1'] })
    expect(mockUpsert).toHaveBeenCalled()
  })

  it('indexProject() skips non-py files', async () => {
    const files = [
      { path: 'README.md', content: '# Hello', source: 'template' as const, validated: true },
      { path: '.env', content: 'KEY=val', source: 'template' as const, validated: true }
    ]

    await client.indexProject('proj1', files)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('deleteProject() calls deleteCollection', async () => {
    await client.ping()
    await client.deleteProject('proj1')
    expect(mockDeleteCollection).toHaveBeenCalledWith({ name: 'mockline-proj1' })
  })

  it('search() returns mapped results on success', async () => {
    mockQuery.mockResolvedValueOnce({
      ids: [['file.py::1']],
      documents: [['def foo(): pass']],
      distances: [[0.2]],
      metadatas: [[{ filepath: 'file.py', startLine: 1, endLine: 3 }]]
    })

    const results = await client.search('proj1', 'foo function', 5)
    expect(results).toHaveLength(1)
    expect(results[0].filepath).toBe('file.py')
    expect(results[0].score).toBeCloseTo(0.8)
    expect(results[0].content).toBe('def foo(): pass')
  })

  it('reset() clears failure state', async () => {
    mockHeartbeat.mockRejectedValueOnce(new Error('down'))
    await client.ping()
    expect(client.isAvailable()).toBe(false)

    client.reset()
    expect(client.isAvailable()).toBe(true)
  })
})
