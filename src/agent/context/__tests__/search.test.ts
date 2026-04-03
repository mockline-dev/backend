import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CodeSearchService } from '../search'
import type { MocklineChromaClient } from '../chroma-client'
import type { Application } from '../../../declarations'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

vi.mock('../../../storage/r2.client', () => ({
  r2Client: {
    listObjects: vi.fn().mockResolvedValue([
      { key: 'projects/proj1/app/main.py' },
      { key: 'projects/proj1/app/utils.py' }
    ]),
    getObject: vi.fn().mockImplementation((key: string) => {
      const files: Record<string, string> = {
        'projects/proj1/app/main.py': 'def create_user(email): pass\ndef delete_user(id): pass',
        'projects/proj1/app/utils.py': 'def hash_password(pwd): return pwd\ndef verify_password(h, p): pass'
      }
      return Promise.resolve(files[key] ?? '')
    })
  }
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeChromaClient(overrides?: Partial<MocklineChromaClient>): MocklineChromaClient {
  return {
    isAvailable: vi.fn().mockReturnValue(true),
    search: vi.fn().mockResolvedValue([
      { filepath: 'app/main.py', content: 'def create_user(email): pass', score: 0.9 }
    ]),
    indexProject: vi.fn().mockResolvedValue(undefined),
    indexFile: vi.fn().mockResolvedValue(undefined),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue(true),
    reset: vi.fn(),
    ...overrides
  } as unknown as MocklineChromaClient
}

const mockApp = {} as Application

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CodeSearchService', () => {
  describe('search()', () => {
    it('uses ChromaDB when available and returns results', async () => {
      const chroma = makeChromaClient()
      const service = new CodeSearchService(chroma, mockApp)

      const results = await service.search('proj1', 'create user', 5)
      expect(chroma.search).toHaveBeenCalledWith('proj1', 'create user', 5)
      expect(results[0].source).toBe('chromadb')
      expect(results[0].filepath).toBe('app/main.py')
    })

    it('falls back to grep when ChromaDB is unavailable', async () => {
      const chroma = makeChromaClient({ isAvailable: vi.fn().mockReturnValue(false) })
      const service = new CodeSearchService(chroma, mockApp)

      const results = await service.search('proj1', 'create_user', 5)
      expect(chroma.search).not.toHaveBeenCalled()
      expect(results[0].source).toBe('grep')
    })

    it('falls back to grep when ChromaDB returns empty results', async () => {
      const chroma = makeChromaClient({
        search: vi.fn().mockResolvedValue([])
      })
      const service = new CodeSearchService(chroma, mockApp)

      const results = await service.search('proj1', 'hash_password', 5)
      // ChromaDB returned empty → grep fallback
      expect(results[0].source).toBe('grep')
    })

    it('falls back to grep when ChromaDB throws', async () => {
      const chroma = makeChromaClient({
        search: vi.fn().mockRejectedValue(new Error('connection lost'))
      })
      const service = new CodeSearchService(chroma, mockApp)

      const results = await service.search('proj1', 'create_user', 5)
      expect(results[0].source).toBe('grep')
    })

    it('works with null chromaClient', async () => {
      const service = new CodeSearchService(null, mockApp)
      const results = await service.search('proj1', 'create_user', 5)
      expect(results[0].source).toBe('grep')
    })

    it('returns empty array when grep finds nothing', async () => {
      const chroma = makeChromaClient({ isAvailable: vi.fn().mockReturnValue(false) })
      const service = new CodeSearchService(chroma, mockApp)

      const results = await service.search('proj1', 'zxqvbnm_nonexistent', 5)
      expect(results).toEqual([])
    })
  })

  describe('indexProject()', () => {
    it('delegates to chromaClient when available', async () => {
      const chroma = makeChromaClient()
      const service = new CodeSearchService(chroma, mockApp)
      const files = [{ path: 'main.py', content: 'pass', source: 'llm' as const, validated: true }]

      await service.indexProject('proj1', files)
      expect(chroma.indexProject).toHaveBeenCalledWith('proj1', files)
    })

    it('no-ops when chromaClient is unavailable', async () => {
      const chroma = makeChromaClient({ isAvailable: vi.fn().mockReturnValue(false) })
      const service = new CodeSearchService(chroma, mockApp)

      await service.indexProject('proj1', [])
      expect(chroma.indexProject).not.toHaveBeenCalled()
    })
  })

  describe('indexFile()', () => {
    it('delegates to chromaClient when available', async () => {
      const chroma = makeChromaClient()
      const service = new CodeSearchService(chroma, mockApp)

      await service.indexFile('proj1', 'app/main.py', 'def foo(): pass')
      expect(chroma.indexFile).toHaveBeenCalledWith('proj1', 'app/main.py', 'def foo(): pass')
    })

    it('no-ops when chromaClient is null', async () => {
      const service = new CodeSearchService(null, mockApp)
      // Should not throw
      await expect(service.indexFile('proj1', 'main.py', '')).resolves.toBeUndefined()
    })
  })

  describe('deleteProject()', () => {
    it('delegates to chromaClient when available', async () => {
      const chroma = makeChromaClient()
      const service = new CodeSearchService(chroma, mockApp)

      await service.deleteProject('proj1')
      expect(chroma.deleteProject).toHaveBeenCalledWith('proj1')
    })
  })
})
