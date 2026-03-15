import { cosineSimilarity, embed } from '../../llm/embeddings'
import { logger } from '../../logger'
import { getRedisClientSync } from '../../services/redis/client'

interface FileEntry {
  path: string
  vector: number[]
  contentPreview: string
}

/**
 * Per-project in-memory embedding store with Redis persistence.
 * Holds file vectors for semantic similarity search.
 * Re-indexes when files are written via agent tools or after rollback.
 */
class EmbeddingStore {
  private projects = new Map<string, FileEntry[]>()
  private readonly REDIS_PREFIX = 'embeddings:'

  async add(projectId: string, path: string, content: string): Promise<void> {
    try {
      const vector = await embed(content)
      const entries = this.projects.get(projectId) ?? []
      // Replace existing entry for same path
      const idx = entries.findIndex(e => e.path === path)
      const entry: FileEntry = { path, vector, contentPreview: content.slice(0, 200) }
      if (idx >= 0) {
        entries[idx] = entry
      } else {
        entries.push(entry)
      }
      this.projects.set(projectId, entries)

      // Persist to Redis
      await this.persistToRedis(projectId, entries)
    } catch (err: any) {
      logger.warn('EmbeddingStore: failed to index %s/%s: %s', projectId, path, err.message)
    }
  }

  async query(projectId: string, queryText: string, topK = 5): Promise<string[]> {
    let entries = this.projects.get(projectId)

    // Load from Redis if not in memory
    if (!entries) {
      const loaded = await this.loadFromRedis(projectId)
      if (loaded) {
        entries = loaded
        this.projects.set(projectId, entries)
      }
    }

    if (!entries || entries.length === 0) return []

    let queryVec: number[]
    try {
      queryVec = await embed(queryText)
    } catch {
      return []
    }

    const scored = entries.map(e => ({
      path: e.path,
      score: cosineSimilarity(queryVec, e.vector)
    }))

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK).map(e => e.path)
  }

  async clear(projectId: string): Promise<void> {
    this.projects.delete(projectId)
    // Clear from Redis
    try {
      const redis = getRedisClientSync()
      await redis.del(`${this.REDIS_PREFIX}${projectId}`)
    } catch (err: any) {
      logger.warn('EmbeddingStore: failed to clear Redis for %s: %s', projectId, err.message)
    }
  }

  has(projectId: string): boolean {
    return this.projects.has(projectId) && (this.projects.get(projectId)?.length ?? 0) > 0
  }

  /**
   * Persist embeddings to Redis
   */
  private async persistToRedis(projectId: string, entries: FileEntry[]): Promise<void> {
    try {
      const redis = getRedisClientSync()
      const data = JSON.stringify(entries)
      await redis.set(`${this.REDIS_PREFIX}${projectId}`, data, 'EX', 24 * 60 * 60) // 24 hour TTL
    } catch (err: any) {
      logger.warn('EmbeddingStore: failed to persist to Redis for %s: %s', projectId, err.message)
    }
  }

  /**
   * Load embeddings from Redis
   */
  private async loadFromRedis(projectId: string): Promise<FileEntry[] | null> {
    try {
      const redis = getRedisClientSync()
      const data = await redis.get(`${this.REDIS_PREFIX}${projectId}`)
      if (data) {
        return JSON.parse(data) as FileEntry[]
      }
    } catch (err: any) {
      logger.warn('EmbeddingStore: failed to load from Redis for %s: %s', projectId, err.message)
    }
    return null
  }
}

export const embeddingStore = new EmbeddingStore()
