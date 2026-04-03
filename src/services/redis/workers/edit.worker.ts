import { Job, Worker } from 'bullmq'

import { executeEditSession } from '../../../agent/editing/agentic-loop'
import { llmClient, getModelConfig } from '../../../llm/client'
import type { IterationEvent } from '../../../llm/tool-calling'
import { app } from '../../../app'
import { logger } from '../../../logger'
import { redisConnection } from '../queues/queue.client'
import type { EditJobData } from '../queues/edit.queue'
import type { ProjectsPatch } from '../../projects/projects.schema'
import { broadcastProgress } from './broadcast'

type ConvMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
}

export const editWorker = new Worker<EditJobData>(
  'edit',
  async (job: Job<EditJobData>) => {
    const { projectId, conversationId, userMessage } = job.data
    const jobId = job.id ?? 'unknown'

    logger.info('Edit job %s started — project %s, message: %s', jobId, projectId, userMessage.slice(0, 80))

    // ── 0. Pre-load editing model to absorb swap time ────────────────────────
    const editingModel = getModelConfig('editing')
    await llmClient.warmModel(editingModel.name)

    // ── 1. Fetch conversation history ────────────────────────────────────────
    let conversationHistory: ConvMessage[] = []
    if (conversationId) {
      try {
        const conv = await app.service('ai-conversations').get(conversationId)
        conversationHistory = Array.isArray(conv.messages) ? (conv.messages as ConvMessage[]) : []
      } catch {
        logger.warn('Edit job %s: could not load conversation %s', jobId, conversationId)
      }
    }

    // ── 2. Pre-edit snapshot ─────────────────────────────────────────────────
    try {
      await app.service('snapshots').create({
        projectId,
        label: `Before edit: ${userMessage.slice(0, 60)}`,
        trigger: 'auto-ai-edit'
      } as never)
    } catch (snapErr: unknown) {
      const msg = snapErr instanceof Error ? snapErr.message : String(snapErr)
      logger.warn('Edit job %s: pre-edit snapshot failed: %s', jobId, msg)
    }

    // ── 3. Update project status → editing ───────────────────────────────────
    await job.updateProgress(5)
    await app.service('projects').patch(projectId, {
      status: 'editing',
      editProgress: { stage: 'starting', percentage: 0, startedAt: Date.now() }
    } satisfies ProjectsPatch)

    app.channel(`projects/${projectId}`).send({
      type: 'edit:started',
      payload: { jobId, userMessage }
    })

    try {
      // ── 4. Execute edit session ────────────────────────────────────────────
      const result = await executeEditSession(
        llmClient,
        projectId,
        userMessage,
        conversationHistory,
        app,
        (iteration: number, detail: IterationEvent) => {
          const pct = Math.min(10 + iteration * 5, 90)
          job.updateProgress(pct).catch(() => {})

          app.channel(`projects/${projectId}`).send({
            type: 'edit:progress',
            payload: { iteration, percent: pct, detail }
          })
          broadcastProgress(app, projectId, { phase: 'editing', step: `iteration:${iteration}`, detail: String(detail), percent: pct })

          app.service('projects').patch(projectId, {
            editProgress: { stage: `iteration:${iteration}`, percentage: pct }
          } satisfies ProjectsPatch).catch(() => {})
        }
      )

      // ── 5. Store / update conversation ────────────────────────────────────
      await job.updateProgress(95)
      try {
        if (conversationId) {
          await app.service('ai-conversations').patch(conversationId, {
            messages: result.messages,
            status: result.success ? 'completed' : 'error',
            summary: result.summary,
            updatedAt: Date.now()
          } as never)
        } else {
          await app.service('ai-conversations').create({
            projectId,
            messages: result.messages,
            status: result.success ? 'completed' : 'error',
            summary: result.summary
          } as never)
        }
      } catch (convErr: unknown) {
        const msg = convErr instanceof Error ? convErr.message : String(convErr)
        logger.warn('Edit job %s: failed to save conversation: %s', jobId, msg)
      }

      // ── 6. Update project status → ready or error ──────────────────────────
      await app.service('projects').patch(projectId, {
        status: result.success ? 'ready' : 'error',
        editProgress: {
          stage: 'complete',
          percentage: 100,
          completedAt: Date.now(),
          iterations: result.iterations,
          ...(!result.success && { errorMessage: result.summary })
        }
      } satisfies ProjectsPatch)

      // ── 7. Broadcast completion ───────────────────────────────────────────
      app.channel(`projects/${projectId}`).send({
        type: 'edit:complete',
        payload: {
          jobId,
          summary: result.summary,
          success: result.success,
          iterations: result.iterations
        }
      })

      await job.updateProgress(100)
      logger.info(
        'Edit job %s completed — %d iterations, success=%s',
        jobId,
        result.iterations,
        result.success
      )

      return { summary: result.summary, iterations: result.iterations }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('Edit job %s failed: %s', jobId, msg)

      await app.service('projects').patch(projectId, {
        status: 'error',
        editProgress: { stage: 'error', percentage: 0, errorMessage: msg }
      } satisfies ProjectsPatch)

      app.channel(`projects/${projectId}`).send({
        type: 'edit:error',
        payload: { jobId, error: msg }
      })

      throw err
    }
  },
  { connection: redisConnection as never, concurrency: 1, lockDuration: 300_000 }
)

editWorker.on('failed', (job, err) => {
  logger.error('Edit job %s permanently failed: %s', job?.id ?? 'unknown', err.message)
})

editWorker.on('completed', job => {
  logger.info('Edit job %s completed', job?.id ?? 'unknown')
})

process.on('SIGTERM', () => {
  editWorker.close().catch(() => {})
})
