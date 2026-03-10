import { Queue } from 'bullmq'
import config from 'config'
import IORedis from 'ioredis'

const redisUrl = config.has('redis') ? config.get<{ url: string }>('redis').url : 'redis://localhost:6379'

export const redisConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
})

export function createQueue(name: string) {
  return new Queue(name, { connection: redisConnection as any })
}
