import { Job, Worker } from 'bullmq'

import { GenerationPipeline } from '../../../agent/pipeline/pipeline'
import { app } from '../../../app'
import { logger } from '../../../logger'
import { jobTracker } from '../queues/job-tracker'
import { redisConnection } from '../queues/queue.client'
import { validationQueue, type GenerationJobData } from '../queues/queues'

export const generationWorker = new Worker<GenerationJobData>(
  'code-generation',
  async (job: Job<GenerationJobData>) => {
    const { projectId, prompt } = job.data
    const jobId = job.id || 'unknown'
    const maxAttempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1
    const currentAttempt = job.attemptsMade + 1
    const isFinalAttempt = currentAttempt >= maxAttempts

    // Register job with tracker (30 minute timeout)
    jobTracker.registerJob(jobId, projectId, 30 * 60 * 1000)

    const PROGRESS_PATCH_DEBOUNCE_MS = 400
    let pendingProgress: Record<string, unknown> | null = null
    let progressTimer: NodeJS.Timeout | null = null

    const flushProgressPatch = async () => {
      if (!pendingProgress) {
        return
      }
      const progress = pendingProgress
      pendingProgress = null
      await app.service('projects').patch(projectId, { generationProgress: progress } as any)
    }

    const scheduleProgressPatch = () => {
      if (progressTimer) {
        return
      }
      progressTimer = setTimeout(() => {
        progressTimer = null
        flushProgressPatch().catch((flushErr: any) => {
          logger.warn('Generation job %s progress flush failed: %s', jobId, flushErr.message)
        })
      }, PROGRESS_PATCH_DEBOUNCE_MS)
    }

    const updateProgress = async (stage: string, percentage: number, currentFile?: string) => {
      const generationProgress: Record<string, unknown> = { currentStage: stage, percentage }
      if (currentFile) generationProgress.currentFile = currentFile

      pendingProgress = generationProgress
      scheduleProgressPatch()
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
        onProgress: updateProgress,
        jobId: jobId // Pass job ID for tracking
      })

      // Check if there are warnings from the pipeline
      const warnings = (result as any).warnings || []

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

      // Determine status based on warnings
      const status = warnings.length > 0 ? 'ready' : 'ready'
      const currentStage = warnings.length > 0 ? 'complete_with_warnings' : 'complete'

      await flushProgressPatch()

      // Link architecture to project
      const projectPatchData: any = {
        status,
        generationProgress: {
          percentage: 100,
          currentStage,
          filesGenerated: result.fileCount,
          totalFiles: result.fileCount,
          completedAt: Date.now(),
          ...(warnings.length > 0 && { warnings })
        }
      }

      // Include architectureId if it was created
      if (result.architectureId) {
        projectPatchData.architectureId = result.architectureId
        logger.info(
          'Generation job %s: linking architecture %s to project %s',
          jobId,
          result.architectureId,
          projectId
        )
      } else {
        logger.warn(
          'Generation job %s: no architectureId returned from pipeline for project %s',
          jobId,
          projectId
        )
      }

      await app.service('projects').patch(projectId, projectPatchData)

      // Log warnings if any
      if (warnings.length > 0) {
        logger.warn(
          'Generation job %s completed with %d warnings: %s',
          jobId,
          warnings.length,
          warnings.join('; ')
        )
      }

      // Mark job as completed and cleanup tracking
      jobTracker.completeJob(jobId)
    } catch (err: any) {
      logger.error('Generation job %s failed: %s', jobId, err.message)

      // Distinguish between validation warnings and actual errors
      const isValidationError = err.message?.includes('validation') || err.message?.includes('Validation')
      const isWarning = err.message?.includes('warning') || err.message?.includes('Warning')

      // If it's a validation warning, treat as partial success
      if (isWarning) {
        logger.warn('Generation job %s completed with warnings: %s', jobId, err.message)
        await flushProgressPatch()
        await app.service('projects').patch(projectId, {
          status: 'ready',
          generationProgress: {
            percentage: 100,
            currentStage: 'complete_with_warnings',
            filesGenerated: 0, // Will be updated by pipeline
            totalFiles: 0,
            completedAt: Date.now(),
            warnings: [err.message]
          }
        } as any)
        jobTracker.completeJob(jobId)
        return // Don't throw - treat as success with warnings
      }

      if (!isFinalAttempt) {
        logger.warn(
          'Generation job %s failed on attempt %d/%d, retrying: %s',
          jobId,
          currentAttempt,
          maxAttempts,
          err.message
        )

        await app.service('projects').patch(projectId, {
          generationProgress: {
            currentStage: 'retrying_generation',
            errorMessage: err.message,
            retryAttempts: currentAttempt
          }
        } as any)

        throw err
      }

      // For actual errors, mark as error and cleanup
      await flushProgressPatch()
      await app.service('projects').patch(projectId, {
        status: 'error',
        generationProgress: {
          errorMessage: err.message,
          errorType: isValidationError ? 'validation_error' : 'generation_error',
          currentStage: 'error',
          percentage: 0,
          filesGenerated: 0,
          totalFiles: 0,
          failedAt: Date.now()
        }
      } as any)

      // Cleanup job resources
      await jobTracker.cancelJob(jobId)

      throw err
    } finally {
      if (progressTimer) {
        clearTimeout(progressTimer)
        progressTimer = null
      }
    }
  },
  { connection: redisConnection as any, concurrency: 3 }
)

generationWorker.on('failed', (job, err) => {
  const jobId = job?.id || 'unknown'
  const maxAttempts = typeof job?.opts?.attempts === 'number' ? job.opts.attempts : 1
  const attemptsMade = job?.attemptsMade ?? 0
  const isFinalFailure = attemptsMade >= maxAttempts

  if (!isFinalFailure) {
    logger.warn('Generation job %s failed attempt %d/%d: %s', jobId, attemptsMade, maxAttempts, err.message)
    return
  }

  logger.error('Generation job %s permanently failed after %d attempts: %s', jobId, attemptsMade, err.message)

  // Ensure cleanup happens even if the job handler didn't complete
  if (job?.data?.projectId) {
    if (jobTracker.getJob(jobId)) {
      jobTracker.cancelJob(jobId).catch(cleanupErr => {
        logger.error('Failed to cleanup job %s: %s', jobId, cleanupErr.message)
      })
    }
  }
})

generationWorker.on('completed', job => {
  const jobId = job?.id || 'unknown'
  logger.info('Generation job %s completed successfully', jobId)
})
