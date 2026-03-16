import { Job, Worker } from 'bullmq'

import { app } from '../../../app'
import { logger } from '../../../logger'
import { redisConnection } from '../queues/queue.client'
import type { DeploymentJobData } from '../queues/queues'

export const deploymentWorker = new Worker<DeploymentJobData>(
  'deployment-tasks',
  async (job: Job<DeploymentJobData>) => {
    const { deploymentId, projectId, target } = job.data

    await app.service('deployments').patch(deploymentId, {
      status: 'running',
      startedAt: Date.now(),
      updatedAt: Date.now()
    } as any)

    // Deployment integration point (future): CI/CD, serverless deploy, container build
    await app.service('deployments').patch(deploymentId, {
      status: 'completed',
      target,
      completedAt: Date.now(),
      updatedAt: Date.now()
    } as any)

    app.channel(`projects/${projectId}`).send({
      type: 'deployment.completed',
      payload: {
        deploymentId,
        projectId,
        target,
        completedAt: Date.now()
      }
    })

    return { deploymentId, status: 'completed' }
  },
  { connection: redisConnection as any, concurrency: 1 }
)

deploymentWorker.on('failed', async (job, error) => {
  const deploymentId = job?.data?.deploymentId
  if (deploymentId) {
    await app.service('deployments').patch(deploymentId, {
      status: 'failed',
      errorMessage: error.message,
      updatedAt: Date.now()
    } as any)
  }

  logger.error('Deployment job failed: %s', error.message)
})
