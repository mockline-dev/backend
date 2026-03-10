import { TooManyRequests } from '@feathersjs/errors'
import IORedis from 'ioredis'
import type { HookContext } from '../declarations'

const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true
})

interface RateLimitOptions {
  windowSeconds: number
  maxRequests: number
  keyPrefix: string
}

export const rateLimit = (options: RateLimitOptions) => async (context: HookContext) => {
  const userId = context.params?.user?._id?.toString()
  if (!userId) return context

  const key = `rate:${options.keyPrefix}:${userId}`
  const current = await redis.incr(key)

  if (current === 1) {
    await redis.expire(key, options.windowSeconds)
  }

  if (current > options.maxRequests) {
    const ttl = await redis.ttl(key)
    throw new TooManyRequests(`Rate limit exceeded. Try again in ${ttl} seconds.`)
  }

  return context
}
