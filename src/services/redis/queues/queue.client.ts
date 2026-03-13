import { Queue } from 'bullmq'

import { getRedisClient } from '../client'

export const redisConnection = getRedisClient()

export function createQueue<T = unknown>(name: string): Queue<T> {
  return new Queue<T>(name, { connection: redisConnection as any })
}
