import { Queue } from 'bullmq'

import { redisConnection } from './queue.client'

export interface GenerationJobData {
  projectId: string
}

export const generationQueue = new Queue<GenerationJobData>('generation', {
  connection: redisConnection as never
})

export async function addGenerationJob(data: GenerationJobData) {
  return generationQueue.add('generate', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 }
  })
}
