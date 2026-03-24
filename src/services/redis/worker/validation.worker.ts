import { Job, Worker } from 'bullmq'
import { validateGeneratedFiles } from '../../../agent/validation/validator'
import { app } from '../../../app'
import { logger } from '../../../logger'
import { jobTracker } from '../queues/job-tracker'
import { redisConnection } from '../queues/queue.client'
import { type ValidationJobData } from '../queues/queues'

/**
 * Validation worker — processes code-validation jobs independently from generation.
 * Receives a list of generated files, validates them, and patches the project record
 * with the validation summary.  Runs with concurrency = 5 since validation is
 * CPU-light (syntax checks only).
 */
export const validationWorker = new Worker<ValidationJobData>(
  'code-validation',
  async (job: Job<ValidationJobData>) => {
    const { projectId, files } = job.data
    const jobId = job.id || 'unknown'

    // Register job with tracker (10 minute timeout for validation)
    jobTracker.registerJob(jobId, projectId, 10 * 60 * 1000)

    logger.info('Validation worker: starting for project %s (%d files)', projectId, files.length)

    try {
      await app.service('projects').patch(projectId, {
        generationProgress: { currentStage: 'validating' }
      } as any)

      const noop = async () => {}
      const summary = await validateGeneratedFiles(files, projectId, app, noop as any)

      // Broadcast validation result to the project channel
      app.channel(`projects/${projectId}`).send({
        type: 'validation:complete',
        payload: {
          passCount: summary.passCount,
          failCount: summary.failCount,
          results: summary.results
        }
      })

      if (summary.failCount > 0) {
        logger.warn(
          'Validation worker: %d/%d files failed for project %s',
          summary.failCount,
          files.length,
          projectId
        )
        // Update project with validation warnings but don't mark as error
        await app.service('projects').patch(projectId, {
          generationProgress: {
            currentStage: 'validation_complete_with_warnings',
            validationResults: {
              passCount: summary.passCount,
              failCount: summary.failCount,
              failedFiles: summary.results.filter(r => !r.valid).map(r => r.path)
            }
          }
        } as any)
      } else {
        logger.info('Validation worker: all files passed for project %s', projectId)
        await app.service('projects').patch(projectId, {
          generationProgress: {
            currentStage: 'validation_complete',
            validationResults: {
              passCount: summary.passCount,
              failCount: 0,
              failedFiles: []
            }
          }
        } as any)
      }

      // Mark job as completed and cleanup tracking
      jobTracker.completeJob(jobId)

      return summary
    } catch (err: any) {
      logger.error('Validation job %s failed: %s', jobId, err.message)

      // Validation failures are non-critical - don't mark project as error
      await app.service('projects').patch(projectId, {
        generationProgress: {
          currentStage: 'validation_error',
          validationError: err.message
        }
      } as any)

      // Cleanup job resources
      await jobTracker.cancelJob(jobId)

      throw err
    }
  },
  { connection: redisConnection as any, concurrency: 5 }
)

validationWorker.on('failed', (job, err) => {
  const jobId = job?.id || 'unknown'
  logger.error('Validation job %s permanently failed: %s', jobId, err.message)

  // Ensure cleanup happens even if the job handler didn't complete
  if (job?.data?.projectId) {
    jobTracker.cancelJob(jobId).catch(cleanupErr => {
      logger.error('Failed to cleanup validation job %s: %s', jobId, cleanupErr.message)
    })
  }
})

validationWorker.on('completed', job => {
  const jobId = job?.id || 'unknown'
  logger.info('Validation job %s completed successfully', jobId)
})
