import { ChromaClient, Collection } from 'chromadb'
import { DefaultEmbeddingFunction } from '@chroma-core/default-embed'
import { createModuleLogger } from '../../logging'
import type { CodeChunk } from '../types'

const log = createModuleLogger('chroma-client')

const COLLECTION_PREFIX = 'proj'

// Singleton embedding function — reused across all collections (model loads once)
const embedFn = new DefaultEmbeddingFunction()

/**
 * Produce a ChromaDB-safe collection name from a projectId.
 * Rules: 3-512 chars, only [a-zA-Z0-9._-], must start AND end with [a-zA-Z0-9].
 */
function sanitizeCollectionName(projectId: string): string {
  // Replace anything that isn't alphanumeric, dot, hyphen, or underscore with a hyphen
  let name = `${COLLECTION_PREFIX}-${projectId}`.replace(/[^a-zA-Z0-9._-]/g, '-')
  // Collapse runs of non-alphanumeric into a single hyphen
  name = name.replace(/[^a-zA-Z0-9]+/g, '-')
  // Strip leading/trailing hyphens (start/end must be alphanumeric)
  name = name.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '')
  // Ensure minimum length of 3
  if (name.length < 3) name = `prj${name}`
  // Truncate to 512
  return name.slice(0, 512)
}

export interface ChromaQueryResult {
  chunk: CodeChunk
  score: number
}

/**
 * ChromaDB vector store wrapper.
 *
 * One collection per project. Uses ChromaDB's built-in all-MiniLM-L6-v2
 * for embeddings — no separate embedding API required.
 *
 * All methods gracefully degrade: if ChromaDB is unreachable, operations
 * return empty results and log a warning instead of throwing.
 */
export class ChromaVectorStore {
  private client: ChromaClient
  private available = false
  private collectionCache = new Map<string, Collection>()

  constructor(host: string, port: number) {
    this.client = new ChromaClient({ path: `http://${host}:${port}` })
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.heartbeat()
      this.available = true
      return true
    } catch {
      this.available = false
      return false
    }
  }

  private async getCollection(projectId: string): Promise<Collection | null> {
    const name = sanitizeCollectionName(projectId)

    const cached = this.collectionCache.get(name)
    if (cached) return cached

    try {
      const collection = await this.client.getOrCreateCollection({
        name,
        embeddingFunction: embedFn,
        metadata: { projectId },
      })
      this.collectionCache.set(name, collection)
      return collection
    } catch (err: unknown) {
      log.warn('ChromaDB collection access failed', {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  /**
   * Index code chunks into ChromaDB. Upserts by chunk ID.
   */
  async addChunks(projectId: string, chunks: CodeChunk[]): Promise<void> {
    if (chunks.length === 0) return

    const collection = await this.getCollection(projectId)
    if (!collection) return

    try {
      await collection.upsert({
        ids: chunks.map((c) => c.id),
        documents: chunks.map((c) => c.content),
        metadatas: chunks.map((c) => ({
          filepath: c.filepath,
          startLine: c.startLine,
          endLine: c.endLine,
          symbolName: c.symbolName ?? '',
          symbolKind: c.symbolKind ?? 'block',
        })),
      })
      log.debug('Indexed chunks', { projectId, count: chunks.length })
    } catch (err: unknown) {
      log.warn('ChromaDB upsert failed', {
        projectId,
        count: chunks.length,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Query the vector store for chunks semantically similar to the query text.
   */
  async query(projectId: string, queryText: string, limit = 10): Promise<ChromaQueryResult[]> {
    const collection = await this.getCollection(projectId)
    if (!collection) return []

    try {
      const results = await collection.query({
        queryTexts: [queryText],
        nResults: Math.min(limit, 50),
      })

      const ids = results.ids[0] ?? []
      const documents = results.documents[0] ?? []
      const metadatas = results.metadatas[0] ?? []
      const distances = results.distances?.[0] ?? []

      return ids.map((id, i) => ({
        chunk: {
          id,
          filepath: (metadatas[i] as any)?.filepath ?? '',
          content: documents[i] ?? '',
          startLine: Number((metadatas[i] as any)?.startLine ?? 0),
          endLine: Number((metadatas[i] as any)?.endLine ?? 0),
          symbolName: (metadatas[i] as any)?.symbolName || undefined,
          symbolKind: ((metadatas[i] as any)?.symbolKind as CodeChunk['symbolKind']) ?? 'block',
        },
        // ChromaDB returns L2 distance; convert to similarity score (lower distance = higher score)
        score: 1 / (1 + (distances[i] ?? 1)),
      }))
    } catch (err: unknown) {
      log.warn('ChromaDB query failed', {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      })
      return []
    }
  }

  /**
   * Delete all chunks belonging to a specific file within a project.
   * Used by the merkle sync layer to remove stale chunks before re-indexing.
   */
  async deleteByFilepath(projectId: string, filepath: string): Promise<void> {
    const collection = await this.getCollection(projectId)
    if (!collection) return
    try {
      await collection.delete({ where: { filepath } })
      log.debug('Deleted chunks for file', { projectId, filepath })
    } catch (err: unknown) {
      log.warn('ChromaDB deleteByFilepath failed', {
        projectId,
        filepath,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Delete all chunks for a project (e.g. when project is deleted).
   */
  async deleteCollection(projectId: string): Promise<void> {
    const name = sanitizeCollectionName(projectId)
    try {
      await this.client.deleteCollection({ name })
      this.collectionCache.delete(name)
      log.info('ChromaDB collection deleted', { projectId })
    } catch (err: unknown) {
      log.warn('ChromaDB delete collection failed', {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

// Module-level singleton
let _store: ChromaVectorStore | null = null

export function getVectorStore(app: { get: (key: string) => any }): ChromaVectorStore {
  if (!_store) {
    const cfg = app.get('chromadb')
    _store = new ChromaVectorStore(cfg.host, cfg.port)
  }
  return _store
}
