import { Queue } from 'bullmq'

import { redisConnection } from './queue.client'

export interface PlanningJobData {
  projectId: string
  userPrompt: string
}

export const planningQueue = new Queue<PlanningJobData>('planning', {
  connection: redisConnection as never,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 100 },
    removeOnFail: { age: 86400, count: 200 }
  }
})

export async function addPlanningJob(data: PlanningJobData) {
  return planningQueue.add('plan', data, {
    jobId: `planning-${data.projectId}-${Date.now()}`
  })
}
