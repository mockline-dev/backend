import { Job, Worker } from 'bullmq'

import { runAgentStep } from '../../../ai/agent-runner'
import { app } from '../../../app'
import { logger } from '../../../logger'
import { redisConnection } from '../queues/queue.client'
import type { AgentJobData } from '../queues/queues'

interface BullmqWorkerTuning {
  concurrency?: number
  lockDurationMs?: number
  stalledIntervalMs?: number
  maxStalledCount?: number
}

interface BullmqConfig {
  workers?: {
    agent?: BullmqWorkerTuning
  }
}

const bullmqConfig = (app.get('bullmq') || {}) as BullmqConfig
const agentTuning = bullmqConfig.workers?.agent || {}

const agentWorkerOptions = {
  connection: redisConnection as any,
  concurrency: agentTuning.concurrency ?? 1,
  lockDuration: agentTuning.lockDurationMs ?? 300_000,
  stalledInterval: agentTuning.stalledIntervalMs ?? 60_000,
  maxStalledCount: agentTuning.maxStalledCount ?? 2
}

export const agentWorker = new Worker<AgentJobData>(
  'agent-tasks',
  async (job: Job<AgentJobData>) => {
    const { projectId, generationId, step, context } = job.data

    const startedAt = Date.now()
    app.channel(`projects/${projectId}`).send({
      type: 'generation.step',
      payload: {
        generationId,
        step,
        status: 'started',
        timestamp: startedAt
      }
    })

    const result = await runAgentStep(app as any, { step, context })

    await app.service('agents').create({
      projectId,
      generationId,
      step,
      summary: result.summary,
      status: 'completed',
      createdAt: Date.now(),
      updatedAt: Date.now()
    } as any)

    app.channel(`projects/${projectId}`).send({
      type: 'generation.step',
      payload: {
        generationId,
        step,
        status: 'completed',
        summary: result.summary,
        durationMs: Date.now() - startedAt,
        timestamp: Date.now()
      }
    })

    return result
  },
  agentWorkerOptions
)

agentWorker.on('failed', async (job, error) => {
  const projectId = job?.data?.projectId
  if (projectId) {
    app.channel(`projects/${projectId}`).send({
      type: 'generation.step',
      payload: {
        generationId: job?.data?.generationId,
        step: job?.data?.step,
        status: 'failed',
        error: error.message,
        timestamp: Date.now()
      }
    })
  }

  logger.error('Agent job failed: %s', error.message)
})

agentWorker.on('stalled', jobId => {
  logger.warn('Agent job stalled: id=%s', jobId)
})
