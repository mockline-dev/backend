import { Queue } from 'bullmq'
import configLib from 'config'

interface RedisConnectionOptions {
  host: string
  port: number
  username?: string
  password?: string
  db?: number
}

function resolveRedisConnection(): RedisConnectionOptions {
  if (configLib.has('redisConfig')) {
    const redisConfig = configLib.get<{
      host?: string
      port?: number
      username?: string
      password?: string
      db?: number
    }>('redisConfig')

    return {
      host: redisConfig.host || '127.0.0.1',
      port: redisConfig.port || 6379,
      username: redisConfig.username || undefined,
      password: redisConfig.password || undefined,
      db: redisConfig.db ?? 0
    }
  }

  const redisUrl = process.env.REDIS_URL
  if (redisUrl) {
    const url = new URL(redisUrl)
    return {
      host: url.hostname || '127.0.0.1',
      port: parseInt(url.port, 10) || 6379,
      username: url.username || undefined,
      password: url.password || undefined,
      db: parseInt(url.pathname.slice(1), 10) || 0
    }
  }

  return {
    host: '127.0.0.1',
    port: 6379,
    db: 0
  }
}

export const redisConnection = resolveRedisConnection()

export function createQueue<T = unknown>(name: string): Queue<T> {
  return new Queue<T>(name, { connection: redisConnection as any })
}
