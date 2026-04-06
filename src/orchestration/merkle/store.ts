import type { Redis } from 'ioredis'
import type { Db } from 'mongodb'
import { createModuleLogger } from '../../logging'
import type { MerkleTreeDocument } from './types'

const log = createModuleLogger('merkle-store')

const COLLECTION = 'merkle-trees'
const REDIS_TTL_SECONDS = 3600  // 1 hour cache TTL

function redisKey(projectId: string): string {
  return `merkle:${projectId}`
}

/**
 * Dual-layer store for merkle tree documents.
 * Redis is the fast read cache; MongoDB is the durable backing store.
 * All reads go through Redis first (cache-aside), writes go through both (write-through).
 */
export class MerkleTreeStore {
  constructor(
    private getDb: () => Promise<Db>,
    private redis: Redis
  ) {}

  async get(projectId: string): Promise<MerkleTreeDocument | null> {
    // 1. Try Redis cache
    try {
      const cached = await this.redis.get(redisKey(projectId))
      if (cached) {
        return JSON.parse(cached) as MerkleTreeDocument
      }
    } catch (err) {
      log.warn('Redis get failed, falling through to MongoDB', {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // 2. Fall through to MongoDB
    try {
      const db = await this.getDb()
      const doc = await db.collection<MerkleTreeDocument>(COLLECTION).findOne({ projectId })
      if (!doc) return null

      // Warm Redis cache
      this._cacheInRedis(projectId, doc).catch(() => {/* non-fatal */})
      return doc
    } catch (err) {
      log.warn('MongoDB get failed', {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  async save(tree: MerkleTreeDocument): Promise<void> {
    const { projectId } = tree

    // 1. Persist to MongoDB (upsert)
    try {
      const db = await this.getDb()
      await db.collection<MerkleTreeDocument>(COLLECTION).replaceOne(
        { projectId },
        { ...tree, lastSyncAt: new Date() },
        { upsert: true }
      )
    } catch (err) {
      log.error('MongoDB save failed', {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }

    // 2. Write-through to Redis cache
    await this._cacheInRedis(projectId, tree).catch(() => {/* non-fatal */})
  }

  async delete(projectId: string): Promise<void> {
    // Delete from Redis
    try {
      await this.redis.del(redisKey(projectId))
    } catch (err) {
      log.warn('Redis delete failed', { projectId, error: err instanceof Error ? err.message : String(err) })
    }

    // Delete from MongoDB
    try {
      const db = await this.getDb()
      await db.collection(COLLECTION).deleteOne({ projectId })
    } catch (err) {
      log.warn('MongoDB delete failed', { projectId, error: err instanceof Error ? err.message : String(err) })
    }
  }

  private async _cacheInRedis(projectId: string, tree: MerkleTreeDocument): Promise<void> {
    await this.redis.set(redisKey(projectId), JSON.stringify(tree), 'EX', REDIS_TTL_SECONDS)
  }
}

/**
 * Create a MerkleTreeStore bound to the given app.
 * Ensures the `merkle-trees` collection has a unique index on `projectId`.
 */
export async function createMerkleTreeStore(app: any, redis: Redis): Promise<MerkleTreeStore> {
  const getDb = () => app.get('mongodbClient') as Promise<Db>

  // Ensure unique index (idempotent)
  try {
    const db = await getDb()
    await db.collection(COLLECTION).createIndex({ projectId: 1 }, { unique: true, background: true })
  } catch (err) {
    log.warn('Failed to create merkle-trees index (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return new MerkleTreeStore(getDb, redis)
}
