import { Job, Worker } from 'bullmq'

import { executeGenerationPipeline } from '../../../agent/generation/generation-pipeline'
import { classifyError } from '../../../agent/pipeline/error-utils'
import { PipelineTimer } from '../../../agent/pipeline/timing'
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
import { llmClient } from '../../../llm/client'

export const generationWorker = new Worker<GenerationJobData>(
  'generation',
  async (job: Job<GenerationJobData>) => {
    const { projectId } = job.data
    const jobId = job.id ?? 'unknown'
    const timer = new PipelineTimer()

    logger.info('Generation job %s started — project %s', jobId, projectId)

    try {
      // ── 1. Fetch project + plan from MongoDB ──────────────────────────────
      const project = await app.service('projects').get(projectId) as Record<string, unknown>
      const plan = project.plan as ProjectPlan | undefined

      if (!plan) {
        throw new Error(`No plan found for project ${projectId} — planning must run first`)
      }

      // ── 2. Update project status → scaffolding ──────────────────────────
      timer.start('scaffolding')
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
      let slotsEnhanced = 0
      let slotsDefaulted = 0
      // Estimate total: template files + LLM files (entities × ~3 + 5 base files)
      const estimatedTotal = plan.entities.length * 3 + 10

      // Configure tree-sitter indexer with app for MongoDB persistence
      treeSitterIndexer.configure(app)

      // ── 3. Execute generation pipeline ──────────────────────────────────
      // Pass llmClient only if entities have custom (non-deterministic) features
      const DETERMINISTIC_FEATURES = new Set(['soft-delete', 'slug', 'search', 'filter'])
      const hasCustomFeatures = plan.entities.some(
        e => e.features?.some((f: string) => !DETERMINISTIC_FEATURES.has(f))
      )

      const { files, summary: genSummary } = await executeGenerationPipeline(
        null,
        plan,
        (step, detail) => {
          if (!scaffoldingDone && step === 'generating') {
            scaffoldingDone = true
            app.service('projects').patch(projectId, {
              status: 'generating',
              generationProgress: { currentStage: 'generating', percentage: 20 }
            } satisfies ProjectsPatch).catch(() => {})
          }

          if (step === 'scaffolded' || step === 'generated') {
            filesGenerated++
            const pct = Math.min(20 + Math.floor((filesGenerated / estimatedTotal) * 60), 80)
            job.updateProgress(pct).catch(() => {})
          }

          if (step === 'enhancing') {
            app.channel(`projects/${projectId}`).send({
              type: 'generation:enhancing',
              payload: { detail }
            })
          }

          if (step === 'enhanced') {
            const isSlot = detail.includes('LLM-enhanced')
            if (isSlot) slotsEnhanced++
            else if (detail.includes('standard template')) slotsDefaulted++
            const pct = Math.min(80 + Math.floor(((slotsEnhanced + slotsDefaulted) / Math.max(1, estimatedTotal)) * 10), 90)
            broadcastProgress(app, projectId, { phase: 'enhancement', step, detail, percent: pct })
          }
        },
        { projectId, indexer: treeSitterIndexer, chromaClient, llmClient: hasCustomFeatures ? llmClient : null }
      )

      const scaffoldingMs = timer.end('scaffolding')

      // ── 4. Upload all files to R2 ────────────────────────────────────────
      timer.start('upload')
      await job.updateProgress(92)
      app.channel(`projects/${projectId}`).send({
        type: 'generation:uploading',
        payload: { fileCount: files.length }
      })

      for (const file of files) {
        const key = `projects/${projectId}/${file.path}`
        await r2Client.putObject(key, file.content)

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

      const uploadMs = timer.end('upload')

      logger.info(
        'Generation job %s: uploaded %d files to R2 for project %s (scaffolding=%dms, upload=%dms)',
        jobId,
        files.length,
        projectId,
        scaffoldingMs,
        uploadMs
      )

      // ── 5. Enqueue validation job ────────────────────────────────────────
      await validationQueue.add(
        'validate',
        { projectId },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
      )

      await job.updateProgress(100)
      app.channel(`projects/${projectId}`).send({
        type: 'generation:complete',
        payload: {
          fileCount: files.length,
          summary: {
            totalFiles: genSummary.totalFiles,
            templateGenerated: genSummary.templateGenerated,
            enhancedFiles: genSummary.enhancedFiles,
            slotEnhanced: genSummary.slotEnhanced,
            slotDefaulted: genSummary.slotDefaulted,
            entities: genSummary.entities,
          },
          timing: timer.summary()
        }
      })
      logger.info(
        'Generation job %s completed — %d files for project %s (total=%dms)',
        jobId,
        files.length,
        projectId,
        timer.total()
      )

      return { fileCount: files.length, summary: genSummary }
    } catch (err: unknown) {
      const { message, category } = classifyError(err)
      logger.error(
        'Generation job %s failed (project %s): %s',
        jobId,
        projectId,
        err instanceof Error ? err.message : String(err)
      )

      // ── On failure: update project status → error ─────────────────────────
      await app.service('projects').patch(projectId, {
        status: 'error',
        errorMessage: message,
        errorType: category,
        generationProgress: {
          currentStage: 'generation_error',
          errorMessage: message,
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
