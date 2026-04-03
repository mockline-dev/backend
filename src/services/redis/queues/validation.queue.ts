import { Queue } from 'bullmq'

import { redisConnection } from './queue.client'

export interface ValidationJobData {
  projectId: string
}

export const validationQueue = new Queue<ValidationJobData>('validation', {
  connection: redisConnection as never
})

export async function addValidationJob(data: ValidationJobData) {
  return validationQueue.add('validate', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 }
  })
}
