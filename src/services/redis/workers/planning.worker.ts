import { Job, Worker } from 'bullmq'

import { executePlanningPipeline } from '../../../agent/planning/planning-pipeline'
import { llmClient } from '../../../llm/client'
import { app } from '../../../app'
import { logger } from '../../../logger'
import { redisConnection } from '../queues/queue.client'
import { generationQueue } from '../queues/generation.queue'
import type { PlanningJobData } from '../queues/planning.queue'
import type { ProjectsPatch } from '../../projects/projects.schema'
import { broadcastProgress } from './broadcast'

// Approximate progress percent per planning step
const STEP_PERCENT: Record<string, number> = {
  requirements: 15,
  entities: 35,
  entity: 50,
  relationships: 65,
  api: 80,
  validation: 95
}

export const planningWorker = new Worker<PlanningJobData>(
  'planning',
  async (job: Job<PlanningJobData>) => {
    const { projectId, userPrompt } = job.data
    const jobId = job.id ?? 'unknown'

    logger.info('Planning job %s started — project %s', jobId, projectId)

    // ── 1. Update project status → planning ─────────────────────────────────
    await job.updateProgress({ step: 'starting', detail: 'Initializing planning', percent: 0 })
    await app.service('projects').patch(projectId, {
      status: 'planning',
      generationProgress: {
        currentStage: 'planning',
        percentage: 0,
        startedAt: Date.now()
      }
    } satisfies ProjectsPatch)

    app.channel(`projects/${projectId}`).send({
      type: 'planning:started',
      payload: { jobId }
    })

    try {
      // ── 2. Execute planning pipeline ──────────────────────────────────────
      const plan = await executePlanningPipeline(
        llmClient,
        userPrompt,
        (step, detail) => {
          const percent = STEP_PERCENT[step] ?? 50
          job.updateProgress({ step, detail, percent }).catch(() => {})
          app.channel(`projects/${projectId}`).send({
            type: 'planning:progress',
            payload: { step, detail, percent }
          })
          broadcastProgress(app, projectId, { phase: 'planning', step, detail, percent })
        }
      )

      // ── 3. Store plan on project record ───────────────────────────────────
      await app.service('projects').patch(projectId, {
        plan: plan as never,
        generationProgress: {
          currentStage: 'plan_complete',
          percentage: 100,
          completedAt: Date.now()
        }
      } satisfies ProjectsPatch)

      // ── 4. Enqueue generation job ─────────────────────────────────────────
      await generationQueue.add(
        'generate',
        { projectId },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
      )

      app.channel(`projects/${projectId}`).send({
        type: 'planning:complete',
        payload: { jobId }
      })
      logger.info('Planning job %s completed for project %s', jobId, projectId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('Planning job %s failed: %s', jobId, msg)

      // ── On failure: update project status → error ─────────────────────────
      await app.service('projects').patch(projectId, {
        status: 'error',
        generationProgress: {
          currentStage: 'planning_error',
          errorMessage: msg,
          failedAt: Date.now()
        }
      } satisfies ProjectsPatch)

      app.channel(`projects/${projectId}`).send({
        type: 'planning:error',
        payload: { msg }
      })
      throw err
    }
  },
  { connection: redisConnection as never, concurrency: 1, lockDuration: 300_000 }
)

planningWorker.on('failed', (job, err) => {
  logger.error('Planning job %s permanently failed: %s', job?.id ?? 'unknown', err.message)
})

planningWorker.on('completed', job => {
  logger.info('Planning job %s completed', job?.id ?? 'unknown')
})

process.on('SIGTERM', () => {
  planningWorker.close().catch(() => {})
})
