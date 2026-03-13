import { Job, Worker } from 'bullmq'
import { validateGeneratedFiles } from '../../agent/validation/validator'
import { app } from '../../app'
import { logger } from '../../logger'
import { redisConnection } from '../queue.client'
import type { ValidationJobData } from '../validation.queue'

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

    logger.info('Validation worker: starting for project %s (%d files)', projectId, files.length)

    try {
      await app.service('projects').patch(projectId, {
        generationProgress: { currentStage: 'validating', percentage: 90 }
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
      } else {
        logger.info('Validation worker: all files passed for project %s', projectId)
      }

      return summary
    } catch (err: any) {
      logger.error('Validation job %s failed: %s', job.id, err.message)
      throw err
    }
  },
  { connection: redisConnection as any, concurrency: 5 }
)

validationWorker.on('failed', (job, err) => {
  logger.error('Validation job %s permanently failed: %s', job?.id, err.message)
})
