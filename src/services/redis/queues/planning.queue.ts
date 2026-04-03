import { Queue } from 'bullmq'

import { redisConnection } from './queue.client'

export interface PlanningJobData {
  projectId: string
  userPrompt: string
}

export const planningQueue = new Queue<PlanningJobData>('planning', {
  connection: redisConnection as never
})

export async function addPlanningJob(data: PlanningJobData) {
  return planningQueue.add('plan', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 }
  })
}
