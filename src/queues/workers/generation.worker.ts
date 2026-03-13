import { Job, Worker } from 'bullmq'
import { GenerationPipeline } from '../../agent/pipeline/pipeline'
import { app } from '../../app'
import { logger } from '../../logger'
import type { GenerationJobData } from '../generation.queue'
import { redisConnection } from '../queue.client'
import { validationQueue } from '../validation.queue'

export const generationWorker = new Worker<GenerationJobData>(
  'code-generation',
  async (job: Job<GenerationJobData>) => {
    const { projectId, prompt } = job.data

    const updateProgress = async (stage: string, percentage: number, currentFile?: string) => {
      const generationProgress: Record<string, unknown> = { currentStage: stage, percentage }
      if (currentFile) generationProgress.currentFile = currentFile

      await app.service('projects').patch(projectId, { generationProgress } as any)
      app.channel(`projects/${projectId}`).send({
        type: 'generation:progress',
        payload: { stage, percentage, currentFile }
      })
    }

    try {
      const pipeline = new GenerationPipeline(app)
      const result = await pipeline.run({
        projectId,
        prompt,
        userId: job.data.userId,
        onProgress: updateProgress
      })

      // Enqueue validation as a separate async job — does not block project completion
      await validationQueue.add(
        'validate',
        { projectId, files: result.files },
        { attempts: 2, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: true }
      )

      // The snapshots before-create hook auto-increments version, copies R2 files,
      // and populates r2Prefix, files, totalSize, fileCount, createdAt from the DB.
      await app.service('snapshots').create({
        projectId,
        trigger: 'auto-generation',
        label: `Initial generation: ${prompt.slice(0, 100)}`
      } as any)

      await app.service('projects').patch(projectId, {
        status: 'ready',
        generationProgress: {
          percentage: 100,
          currentStage: 'complete',
          filesGenerated: result.fileCount,
          totalFiles: result.fileCount,
          completedAt: Date.now()
        }
      } as any)
    } catch (err: any) {
      logger.error('Generation job %s failed: %s', job.id, err.message)
      await app.service('projects').patch(projectId, {
        status: 'error',
        generationProgress: {
          errorMessage: err.message,
          currentStage: 'error',
          percentage: 0,
          filesGenerated: 0,
          totalFiles: 0
        }
      } as any)
      throw err
    }
  },
  { connection: redisConnection as any, concurrency: 3 }
)

generationWorker.on('failed', (job, err) => {
  logger.error('Generation job %s permanently failed: %s', job?.id, err.message)
})
