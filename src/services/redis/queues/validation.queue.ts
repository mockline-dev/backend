import { Queue } from 'bullmq'

import { redisConnection } from './queue.client'

export interface ValidationJobData {
  projectId: string
}

export const validationQueue = new Queue<ValidationJobData>('validation', {
  connection: redisConnection as never,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 100 },
    removeOnFail: { age: 86400, count: 200 }
  }
})

export async function addValidationJob(data: ValidationJobData) {
  return validationQueue.add('validate', data)
}
