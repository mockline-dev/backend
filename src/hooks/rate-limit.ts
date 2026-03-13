import { TooManyRequests } from '@feathersjs/errors'
import type { HookContext } from '../declarations'
import { getRedisClient } from '../services/redis/client'

// Get Redis client singleton
let redis: Awaited<ReturnType<typeof getRedisClient>> | null = null

interface RateLimitOptions {
  windowSeconds: number
  maxRequests: number
  keyPrefix: string
}

export const rateLimit = (options: RateLimitOptions) => async (context: HookContext) => {
  const userId = context.params?.user?._id?.toString()
  if (!userId) return context

  // Initialize Redis client on first use
  if (!redis) {
    redis = await getRedisClient()
  }

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
