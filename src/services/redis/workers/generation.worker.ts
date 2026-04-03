import { Job, Worker } from 'bullmq'

import { executeGenerationPipeline } from '../../../agent/generation/generation-pipeline'
import { llmClient, getModelConfig } from '../../../llm/client'
import { r2Client } from '../../../storage/r2.client'
import { app } from '../../../app'
import { logger } from '../../../logger'
import type { ProjectPlan } from '../../../types'
import { redisConnection } from '../queues/queue.client'
import { validationQueue } from '../queues/validation.queue'
import type { GenerationJobData } from '../queues/generation.queue'
import type { ProjectsPatch } from '../../projects/projects.schema'
import { treeSitterIndexer } from '../../../agent/context/tree-sitter-indexer'
import { chromaClient } from '../../../agent/context/chroma-client'
import { broadcastProgress } from './broadcast'

export const generationWorker = new Worker<GenerationJobData>(
  'generation',
  async (job: Job<GenerationJobData>) => {
    const { projectId } = job.data
    const jobId = job.id ?? 'unknown'

    logger.info('Generation job %s started — project %s', jobId, projectId)

    // ── 0. Pre-load generation model to absorb swap time ────────────────────
    const generationModel = getModelConfig('generation')
    await llmClient.warmModel(generationModel.name)

    // ── 1. Fetch project + plan from MongoDB ────────────────────────────────
    const project = await app.service('projects').get(projectId) as Record<string, unknown>
    const plan = project.plan as ProjectPlan | undefined

    if (!plan) {
      throw new Error(`No plan found for project ${projectId} — planning must run first`)
    }

    try {
      // ── 2. Update project status → scaffolding ───────────────────────────
      await job.updateProgress(5)
      await app.service('projects').patch(projectId, {
        status: 'scaffolding',
        generationProgress: {
          currentStage: 'scaffolding',
          percentage: 5,
          startedAt: Date.now()
        }
      } satisfies ProjectsPatch)

      app.channel(`projects/${projectId}`).send({
        type: 'generation:started',
        payload: { jobId, stage: 'scaffolding' }
      })

      let scaffoldingDone = false
      let filesGenerated = 0
      // Estimate total: template files + LLM files (entities × ~3 + 5 base files)
      const estimatedTotal = plan.entities.length * 3 + 10

      // Configure tree-sitter indexer with app for MongoDB persistence
      treeSitterIndexer.configure(app)

      // ── 3. Execute scaffolding + LLM generation ──────────────────────────
      const files = await executeGenerationPipeline(
        llmClient,
        plan,
        (step, detail) => {
          if (!scaffoldingDone && step === 'generating') {
            // First LLM call — transition to generating status
            scaffoldingDone = true
            app.service('projects').patch(projectId, {
              status: 'generating',
              generationProgress: { currentStage: 'generating', percentage: 20 }
            } satisfies ProjectsPatch).catch(() => {})
          }

          if (step === 'generated') {
            filesGenerated++
            const pct = Math.min(20 + Math.floor((filesGenerated / estimatedTotal) * 70), 90)
            job.updateProgress(pct).catch(() => {})
            app.channel(`projects/${projectId}`).send({
              type: 'generation:progress',
              payload: { step, detail, percent: pct, filesGenerated }
            })
            broadcastProgress(app, projectId, { phase: 'generation', step, detail, percent: pct })
          }
        },
        { projectId, indexer: treeSitterIndexer, chromaClient }
      )

      // ── 4. Upload all files to R2 ─────────────────────────────────────────
      await job.updateProgress(92)
      app.channel(`projects/${projectId}`).send({
        type: 'generation:uploading',
        payload: { fileCount: files.length }
      })

      for (const file of files) {
        const key = `projects/${projectId}/${file.path}`
        await r2Client.putObject(key, file.content)

        // Upsert MongoDB file record
        const existing = await app.service('files').find({
          query: { projectId, key, $limit: 1 }
        }) as { total: number; data: Array<{ _id: unknown }> }

        if (existing.total > 0) {
          await app.service('files').patch(existing.data[0]._id as string, {
            size: Buffer.byteLength(file.content),
            updatedAt: Date.now()
          })
        } else {
          const ext = file.path.split('.').pop() ?? ''
          const fileType = ext === 'py' ? 'python' : ext === 'ts' ? 'typescript' : 'text'
          await app.service('files').create({
            projectId,
            name: file.path.split('/').pop() ?? file.path,
            key,
            fileType,
            size: Buffer.byteLength(file.content)
          } as never)
        }
      }

      logger.info(
        'Generation job %s: uploaded %d files to R2 for project %s',
        jobId,
        files.length,
        projectId
      )

      // ── 5. Enqueue validation job ─────────────────────────────────────────
      await validationQueue.add(
        'validate',
        { projectId },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
      )

      await job.updateProgress(100)
      app.channel(`projects/${projectId}`).send({
        type: 'generation:complete',
        payload: { fileCount: files.length }
      })
      logger.info(
        'Generation job %s completed — %d files for project %s',
        jobId,
        files.length,
        projectId
      )

      return { fileCount: files.length }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('Generation job %s failed: %s', jobId, msg)

      // ── On failure: update project status → error ─────────────────────────
      await app.service('projects').patch(projectId, {
        status: 'error',
        generationProgress: {
          currentStage: 'generation_error',
          errorMessage: msg,
          failedAt: Date.now()
        }
      } satisfies ProjectsPatch)

      throw err
    }
  },
  { connection: redisConnection as never, concurrency: 1, lockDuration: 300_000 }
)

generationWorker.on('failed', (job, err) => {
  logger.error('Generation job %s permanently failed: %s', job?.id ?? 'unknown', err.message)
})

generationWorker.on('completed', job => {
  logger.info('Generation job %s completed', job?.id ?? 'unknown')
})

process.on('SIGTERM', () => {
  generationWorker.close().catch(() => {})
})
