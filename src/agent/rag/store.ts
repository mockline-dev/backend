import { embed, cosineSimilarity } from '../../llm/embeddings'
import { logger } from '../../logger'
import type { Application } from '../../declarations'

interface FileEntry {
  path: string
  vector: number[]
}

interface EmbeddingDoc {
  projectId: string
  path: string
  vector: number[]
  updatedAt: number
}

/** Minimum cosine similarity to be included in query results. */
const SIMILARITY_THRESHOLD = 0.35

/**
 * Per-project embedding store with optional MongoDB persistence.
 *
 * Call `embeddingStore.configure(app)` once at startup to enable persistence.
 * Without it the store operates in-memory only (vectors lost on restart).
 */
class EmbeddingStore {
  private cache = new Map<string, FileEntry[]>()
  private loadedFromDb = new Set<string>()
  private app: Application | null = null

  /** Wire up MongoDB persistence. Called once from services/index.ts. */
  configure(app: Application): void {
    this.app = app
  }

  async add(projectId: string, path: string, content: string): Promise<void> {
    try {
      const vector = await embed(content)
      this.upsertCache(projectId, path, vector)

      if (this.app) {
        const collection = await this.getCollection()
        await collection.replaceOne(
          { projectId, path },
          { projectId, path, vector, updatedAt: Date.now() } satisfies EmbeddingDoc,
          { upsert: true }
        )
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('EmbeddingStore: failed to index %s/%s: %s', projectId, path, msg)
    }
  }

  async query(projectId: string, queryText: string, topK = 5): Promise<string[]> {
    // Lazy-load from MongoDB on first query if not already in cache
    if (this.app && !this.loadedFromDb.has(projectId)) {
      await this.loadProjectFromDb(projectId)
    }

    const entries = this.cache.get(projectId)
    if (!entries || entries.length === 0) return []

    let queryVec: number[]
    try {
      queryVec = await embed(queryText)
    } catch {
      return []
    }

    const scored = entries
      .map(e => ({ path: e.path, score: cosineSimilarity(queryVec, e.vector) }))
      .filter(e => e.score >= SIMILARITY_THRESHOLD)

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK).map(e => e.path)
  }

  remove(projectId: string, path: string): void {
    const entries = this.cache.get(projectId)
    if (entries) {
      const idx = entries.findIndex(e => e.path === path)
      if (idx >= 0) entries.splice(idx, 1)
    }

    if (this.app) {
      this.getCollection()
        .then(col => col.deleteOne({ projectId, path }))
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          logger.warn('EmbeddingStore: failed to remove %s/%s: %s', projectId, path, msg)
        })
    }
  }

  clear(projectId: string): void {
    this.cache.delete(projectId)
    this.loadedFromDb.delete(projectId)

    if (this.app) {
      this.getCollection()
        .then(col => col.deleteMany({ projectId }))
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          logger.warn('EmbeddingStore: failed to clear project %s: %s', projectId, msg)
        })
    }
  }

  has(projectId: string): boolean {
    return this.cache.has(projectId) && (this.cache.get(projectId)?.length ?? 0) > 0
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private upsertCache(projectId: string, path: string, vector: number[]): void {
    const entries = this.cache.get(projectId) ?? []
    const idx = entries.findIndex(e => e.path === path)
    if (idx >= 0) {
      entries[idx] = { path, vector }
    } else {
      entries.push({ path, vector })
    }
    this.cache.set(projectId, entries)
  }

  private async loadProjectFromDb(projectId: string): Promise<void> {
    try {
      const collection = await this.getCollection()
      const docs = await collection.find({ projectId }).toArray() as unknown as EmbeddingDoc[]
      const entries: FileEntry[] = docs.map(d => ({ path: d.path, vector: d.vector }))
      this.cache.set(projectId, entries)
      this.loadedFromDb.add(projectId)
      logger.debug('EmbeddingStore: loaded %d vectors for project %s from MongoDB', entries.length, projectId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('EmbeddingStore: failed to load project %s from MongoDB: %s', projectId, msg)
      // Mark as loaded to avoid retry storms on every query
      this.loadedFromDb.add(projectId)
    }
  }

  private async getCollection() {
    if (!this.app) throw new Error('EmbeddingStore: not configured with app instance')
    const db = await this.app.get('mongodbClient')
    const collection = db.collection('project_embeddings')
    // Index is idempotent — createIndex is a no-op if it already exists
    await collection.createIndex({ projectId: 1, path: 1 }, { unique: true, background: true })
    return collection
  }
}

export const embeddingStore = new EmbeddingStore()
