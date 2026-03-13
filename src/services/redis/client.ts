import configLib from 'config'
import IORedis, { type Redis } from 'ioredis'

import { logger } from '../../logger'

export interface RedisConfig {
  url?: string
  host?: string
  port?: number
  username?: string
  password?: string
  db?: number
}

export class RedisClientSingleton {
  private static instance: Redis | null = null
  private static isInitializing = false
  private static initPromise: Promise<Redis> | null = null
  private static appConfig: RedisConfig | null = null

  static configureFromApp(app: any): void {
    const redisConfig = app.get('redisConfig')
    this.appConfig = {
      host: redisConfig.host,
      port: redisConfig.port,
      username: redisConfig.username || undefined,
      password: redisConfig.password || undefined,
      db: redisConfig.db ?? 0
    }
  }

  static getCurrentInstance(): Redis | null {
    return this.instance
  }

  static async getInstance(config?: RedisConfig): Promise<Redis> {
    if (this.instance) {
      return this.instance
    }

    if (this.isInitializing && this.initPromise) {
      return this.initPromise
    }

    this.isInitializing = true
    this.initPromise = this.createInstance(config)

    try {
      this.instance = await this.initPromise
      return this.instance
    } finally {
      this.isInitializing = false
      this.initPromise = null
    }
  }

  private static async createInstance(config?: RedisConfig): Promise<Redis> {
    const redisConfig = this.resolveConfig(config)

    logger.info('Initializing Redis client...', {
      host: redisConfig.host,
      port: redisConfig.port,
      db: redisConfig.db
    })

    const redis = new IORedis({
      host: redisConfig.host,
      port: redisConfig.port,
      username: redisConfig.username || undefined,
      password: redisConfig.password || undefined,
      db: redisConfig.db,
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000)
        logger.warn(`Redis connection attempt ${times} failed, retrying in ${delay}ms`)
        return delay
      }
    })

    redis.on('connect', () => {
      logger.info('Redis connected successfully')
    })

    redis.on('ready', () => {
      logger.info('Redis ready to accept commands')
    })

    redis.on('error', err => {
      logger.error('Redis error:', err)
    })

    redis.on('close', () => {
      logger.info('Redis connection closed')
    })

    redis.on('reconnecting', (delay: number) => {
      logger.info(`Redis reconnecting in ${delay}ms`)
    })

    try {
      await redis.connect()
      logger.info('Redis client initialized successfully')
    } catch (err) {
      logger.error('Failed to initialize Redis client:', err)
      throw err
    }

    return redis
  }

  private static resolveConfig(config?: RedisConfig): Required<RedisConfig> {
    if (config?.url) {
      const url = new URL(config.url)
      return {
        url: config.url,
        host: url.hostname,
        port: parseInt(url.port) || 6379,
        username: url.username || '',
        password: url.password || '',
        db: parseInt(url.pathname.slice(1)) || 0
      }
    }

    if (this.appConfig) {
      return {
        url: this.appConfig.url || 'redis://localhost:6379',
        host: this.appConfig.host || '127.0.0.1',
        port: this.appConfig.port || 6379,
        username: this.appConfig.username || '',
        password: this.appConfig.password || '',
        db: this.appConfig.db ?? 0
      }
    }

    if (configLib.has('redisConfig')) {
      const appRedisConfig = configLib.get<{
        host: string
        port: number
        username?: string | null
        password?: string
        db?: number
      }>('redisConfig')

      return {
        url: 'redis://localhost:6379',
        host: appRedisConfig.host || '127.0.0.1',
        port: appRedisConfig.port || 6379,
        username: appRedisConfig.username || '',
        password: appRedisConfig.password || '',
        db: appRedisConfig.db ?? 0
      }
    }

    const redisUrl = process.env.REDIS_URL
    if (redisUrl) {
      const url = new URL(redisUrl)
      return {
        url: redisUrl,
        host: url.hostname,
        port: parseInt(url.port) || 6379,
        username: url.username || '',
        password: url.password || '',
        db: parseInt(url.pathname.slice(1)) || 0
      }
    }

    return {
      url: config?.url || 'redis://localhost:6379',
      host: config?.host || '127.0.0.1',
      port: config?.port || 6379,
      username: config?.username || '',
      password: config?.password || '',
      db: config?.db ?? 0
    }
  }

  static async close(): Promise<void> {
    if (this.instance) {
      logger.info('Closing Redis connection...')
      try {
        await this.instance.quit()
        logger.info('Redis connection closed successfully')
      } catch (err) {
        logger.warn('Error closing Redis connection:', err)
        try {
          this.instance.disconnect()
        } catch (disconnectErr) {
          logger.error('Error disconnecting Redis:', disconnectErr)
        }
      }
      this.instance = null
    }
  }

  static reset(): void {
    this.instance = null
    this.isInitializing = false
    this.initPromise = null
  }

  static isInitialized(): boolean {
    return this.instance !== null
  }
}

export async function getRedisClient(config?: RedisConfig): Promise<Redis> {
  return RedisClientSingleton.getInstance(config)
}

export function configureRedisClientFromApp(app: any): void {
  RedisClientSingleton.configureFromApp(app)
}

export function getRedisClientSync(): Redis {
  const instance = RedisClientSingleton.getCurrentInstance()
  if (!instance) {
    throw new Error(
      'Redis client not initialized. Call getRedisClient() first or ensure Redis service is configured.'
    )
  }
  return instance
}

export async function closeRedisClient(): Promise<void> {
  return RedisClientSingleton.close()
}
