import { Queue } from 'bullmq'
import configLib from 'config'

interface RedisConfigEntry {
  host: string
  port: number
  username?: string
  password?: string
  db?: number
}

const cfg = configLib.get<RedisConfigEntry>('redisConfig')

/**
 * BullMQ connection options — NOT a shared IORedis instance.
 * BullMQ creates its own dedicated connections per Queue/Worker.
 * maxRetriesPerRequest: null is required by BullMQ.
 */
export const redisConnection = {
  host: cfg.host || '127.0.0.1',
  port: cfg.port || 6379,
  ...(cfg.password ? { password: cfg.password } : {}),
  ...(cfg.username && cfg.username !== 'default' ? { username: cfg.username } : {}),
  db: cfg.db ?? 0,
  maxRetriesPerRequest: null as null,
  enableReadyCheck: false
}

export function createQueue<T = unknown>(name: string): Queue<T> {
  return new Queue<T>(name, { connection: redisConnection })
}
