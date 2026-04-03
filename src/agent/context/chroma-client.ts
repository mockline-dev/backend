import config from 'config'

import { logger } from '../../logger'
import type { GeneratedFile } from '../../types'
import { chunkFile } from './code-chunker'
import { OllamaEmbeddingFunction } from './embedding-provider'

// ─── Config ───────────────────────────────────────────────────────────────────

interface ChromaDbConfig {
  host: string
  port: number
  collection: string
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface ChromaSearchResult {
  filepath: string
  content: string
  score: number
}

// ─── Minimal shapes for chromadb v3 API ──────────────────────────────────────

type ChromaCollection = {
  upsert(args: {
    ids: string[]
    embeddings: number[][]
    documents: string[]
    metadatas: Record<string, string | number | boolean>[]
  }): Promise<unknown>
  query(args: {
    queryEmbeddings: number[][]
    nResults: number
    include?: string[]
  }): Promise<{
    ids: string[][]
    documents: (string | null)[][] | null
    distances: number[][] | null
    metadatas: (Record<string, string | number | boolean> | null)[][] | null
  }>
  delete(args: { ids: string[] }): Promise<unknown>
}

type ChromaBaseClient = {
  heartbeat(): Promise<number>
  getOrCreateCollection(args: {
    name: string
    embeddingFunction?: unknown
  }): Promise<ChromaCollection>
  deleteCollection(args: { name: string }): Promise<unknown>
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RETRY_INTERVAL_MS = 30_000
const HEARTBEAT_CACHE_MS = 60_000

// ─── MocklineChromaClient ─────────────────────────────────────────────────────

/**
 * Thin wrapper around the ChromaDB JavaScript client.
 *
 * Handles ChromaDB being unavailable gracefully:
 * - Connection failures are logged as warnings, not errors
 * - All methods return empty results when ChromaDB is unavailable
 * - Retries connection after 30s cooldown (not a permanent one-way latch)
 * - Heartbeat check is cached for 60s to avoid redundant pings
 * - The system works perfectly without ChromaDB (it's an enhancement)
 */
export class MocklineChromaClient {
  private readonly host: string
  private readonly port: number
  private readonly embedFn: OllamaEmbeddingFunction
  private client: ChromaBaseClient | null = null
  private lastFailureAt = 0
  private lastHeartbeatAt = 0

  constructor() {
    const cfg = config.get<ChromaDbConfig>('chromadb')
    this.host = cfg.host ?? 'localhost'
    this.port = cfg.port ?? 8001
    this.embedFn = new OllamaEmbeddingFunction()
  }

  /** Reset connection state — call after spawning a new ChromaDB process. */
  reset(): void {
    this.client = null
    this.lastFailureAt = 0
    this.lastHeartbeatAt = 0
  }

  /** Returns true when ChromaDB is connected or not yet attempted. */
  isAvailable(): boolean {
    if (this.lastFailureAt > 0 && Date.now() - this.lastFailureAt < RETRY_INTERVAL_MS) {
      return false
    }
    return this.client !== null || this.lastFailureAt === 0
  }

  private invalidateClient(): void {
    this.client = null
    this.lastFailureAt = Date.now()
    this.lastHeartbeatAt = 0
  }

  private collectionName(projectId: string): string {
    return `mockline-${projectId}`
  }

  private async getClient(): Promise<ChromaBaseClient | null> {
    if (this.lastFailureAt > 0 && Date.now() - this.lastFailureAt < RETRY_INTERVAL_MS) {
      return null
    }

    if (this.client) {
      // Use cached heartbeat to avoid redundant pings
      if (Date.now() - this.lastHeartbeatAt < HEARTBEAT_CACHE_MS) {
        return this.client
      }
      try {
        await this.client.heartbeat()
        this.lastHeartbeatAt = Date.now()
        return this.client
      } catch {
        this.invalidateClient()
        return null
      }
    }

    try {
      // Dynamic import to avoid crash if chromadb package is not installed
      // @ts-ignore — chromadb may not be installed; handled at runtime
      const chromaModule = await import('chromadb')
      const BaseClient = chromaModule.ChromaClient as unknown as new (cfg: {
        ssl: boolean
        host: string
        port: number
      }) => ChromaBaseClient
      const c = new BaseClient({ ssl: false, host: this.host, port: this.port })
      await c.heartbeat()
      this.client = c
      this.lastFailureAt = 0
      this.lastHeartbeatAt = Date.now()
      logger.info('ChromaClient: connected to ChromaDB at %s:%d', this.host, this.port)
      return this.client
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn(
        'ChromaClient: ChromaDB unavailable (%s) — semantic search disabled (retry in %ds)',
        msg,
        RETRY_INTERVAL_MS / 1000
      )
      this.invalidateClient()
      return null
    }
  }

  private async getOrCreateCollection(projectId: string): Promise<ChromaCollection | null> {
    const client = await this.getClient()
    if (!client) return null
    try {
      return await client.getOrCreateCollection({
        name: this.collectionName(projectId),
        embeddingFunction: this.embedFn
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('ChromaClient: getOrCreateCollection failed: %s', msg)
      this.invalidateClient()
      return null
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Index all .py files from a generated project. */
  async indexProject(projectId: string, files: GeneratedFile[]): Promise<void> {
    const collection = await this.getOrCreateCollection(projectId)
    if (!collection) return

    const pyFiles = files.filter(f => f.path.endsWith('.py'))

    for (const file of pyFiles) {
      await this.upsertFileChunks(collection, file.path, file.content)
    }

    logger.info('ChromaClient: indexed %d Python files for project %s', pyFiles.length, projectId)
  }

  /** Re-index a single file (deletes old chunks then upserts new ones). */
  async indexFile(projectId: string, filepath: string, content: string): Promise<void> {
    const collection = await this.getOrCreateCollection(projectId)
    if (!collection) return

    await this.deleteFileChunks(collection, filepath)
    await this.upsertFileChunks(collection, filepath, content)
    logger.debug('ChromaClient: re-indexed file %s for project %s', filepath, projectId)
  }

  async search(projectId: string, query: string, limit = 5): Promise<ChromaSearchResult[]> {
    const collection = await this.getOrCreateCollection(projectId)
    if (!collection) return []

    try {
      const embeddings = await this.embedFn.generate([query])
      const queryEmbedding = embeddings[0]

      const results = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: limit,
        include: ['documents', 'distances', 'metadatas']
      })

      const ids = results.ids[0] ?? []
      const docs = results.documents?.[0] ?? []
      const distances = results.distances?.[0] ?? []
      const metas = results.metadatas?.[0] ?? []

      return ids.map((id, i) => {
        const meta = metas[i]
        const filepath = meta && typeof meta.filepath === 'string' ? meta.filepath : id
        const content = docs[i] ?? ''
        const dist = distances[i] ?? 1
        return { filepath, content, score: 1 - dist }
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('ChromaClient: search failed: %s', msg)
      this.invalidateClient()
      return []
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    const client = await this.getClient()
    if (!client) return
    try {
      await client.deleteCollection({ name: this.collectionName(projectId) })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('ChromaClient: deleteProject failed: %s', msg)
      this.invalidateClient()
    }
  }

  /** Heartbeat check for startup diagnostics. */
  async ping(): Promise<boolean> {
    const client = await this.getClient()
    if (!client) return false
    try {
      await client.heartbeat()
      return true
    } catch {
      this.invalidateClient()
      return false
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async upsertFileChunks(
    collection: ChromaCollection,
    filepath: string,
    content: string
  ): Promise<void> {
    const chunks = chunkFile(filepath, content)
    if (chunks.length === 0) return

    try {
      const embeddings = await this.embedFn.generate(chunks.map(c => c.content))

      await collection.upsert({
        ids: chunks.map(c => c.id),
        embeddings,
        documents: chunks.map(c => c.content),
        metadatas: chunks.map(c => ({
          filepath: c.filepath,
          startLine: c.startLine,
          endLine: c.endLine,
          type: c.type,
          name: c.name
        }))
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('ChromaClient: failed to index %s: %s', filepath, msg)
      this.invalidateClient()
      throw err
    }
  }

  private async deleteFileChunks(collection: ChromaCollection, filepath: string): Promise<void> {
    try {
      // ChromaDB delete by where filter — but our API shape uses ids.
      // We prefix ids with filepath so we can reconstruct them; however,
      // ChromaDB v3 supports where filter on metadata. Use a workaround:
      // query for existing ids then delete by id.
      const existing = await collection.query({
        queryEmbeddings: [new Array(768).fill(0) as number[]],
        nResults: 500,
        include: ['metadatas']
      })

      const ids: string[] = []
      const metaRows = existing.metadatas?.[0] ?? []
      const idRows = existing.ids?.[0] ?? []

      for (let i = 0; i < metaRows.length; i++) {
        const meta = metaRows[i]
        if (meta && typeof meta.filepath === 'string' && meta.filepath === filepath) {
          ids.push(idRows[i])
        }
      }

      if (ids.length > 0) {
        await collection.delete({ ids })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.debug('ChromaClient: deleteFileChunks for %s: %s', filepath, msg)
    }
  }
}

// Backward-compat alias
export type ChromaClient = MocklineChromaClient

export const chromaClient = new MocklineChromaClient()
