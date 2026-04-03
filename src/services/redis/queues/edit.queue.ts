import { Queue } from 'bullmq'

import { redisConnection } from './queue.client'

export interface EditJobData {
  projectId: string
  conversationId: string
  userMessage: string
}

export const editQueue = new Queue<EditJobData>('edit', {
  connection: redisConnection as never
})

export async function addEditJob(data: EditJobData) {
  return editQueue.add('edit', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 }
  })
}
