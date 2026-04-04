import type { Application } from '../../declarations'
import { logger } from '../../logger'
import { planningQueue } from '../redis/queues/planning.queue'
import { generationQueue } from '../redis/queues/generation.queue'
import { validationQueue } from '../redis/queues/validation.queue'

const STALE_STATUS = ['planning', 'scaffolding', 'generating', 'validating'] as string[]
const STALE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes
const MAX_RETRIES = 2

const STATUS_TO_QUEUE: Record<string, 'planning' | 'generation' | 'validation'> = {
  planning: 'planning',
  scaffolding: 'generation',
  generating: 'generation',
  validating: 'validation',
}

/**
 * Detect projects stuck in transient states and either retry or mark as failed.
 *
 * - If retryAttempts < MAX_RETRIES: re-enqueue to the appropriate queue, increment retryAttempts
 * - If retryAttempts >= MAX_RETRIES: mark status='error' with a user-friendly message
 */
export async function cleanupStaleProjects(
  app: Application
): Promise<{ retried: number; failed: number }> {
  const cutoff = Date.now() - STALE_THRESHOLD_MS

  let stale: Array<Record<string, unknown>>
  try {
    const result = await app.service('projects').find({
      query: {
        status: { $in: STALE_STATUS as never },
        updatedAt: { $lt: cutoff },
        $limit: 100
      },
      paginate: false
    }) as Array<Record<string, unknown>>
    stale = result
  } catch (err: unknown) {
    logger.error(
      'cleanupStaleProjects: failed to query stale projects: %s',
      err instanceof Error ? err.message : String(err)
    )
    return { retried: 0, failed: 0 }
  }

  if (stale.length === 0) {
    logger.debug('cleanupStaleProjects: no stale projects found')
    return { retried: 0, failed: 0 }
  }

  logger.info('cleanupStaleProjects: found %d stale project(s)', stale.length)

  let retried = 0
  let failed = 0

  for (const project of stale) {
    const projectId = String(project._id)
    const status = String(project.status)
    const retryAttempts = typeof project.retryAttempts === 'number' ? project.retryAttempts : 0

    try {
      if (retryAttempts < MAX_RETRIES) {
        // Re-enqueue to the right queue
        const queueName = STATUS_TO_QUEUE[status]
        if (!queueName) {
          logger.warn('cleanupStaleProjects: unknown status "%s" for project %s', status, projectId)
          continue
        }

        if (queueName === 'planning') {
          const prompt = String((project as Record<string, unknown>).userPrompt ?? '')
          await planningQueue.add(
            'plan',
            { projectId, userPrompt: prompt },
            { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
          )
        } else if (queueName === 'generation') {
          await generationQueue.add(
            'generate',
            { projectId },
            { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
          )
        } else {
          await validationQueue.add(
            'validate',
            { projectId },
            { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
          )
        }

        await app.service('projects').patch(projectId, {
          retryAttempts: retryAttempts + 1,
          errorMessage: undefined
        })

        logger.info(
          'cleanupStaleProjects: re-enqueued project %s (status=%s, attempt %d/%d)',
          projectId,
          status,
          retryAttempts + 1,
          MAX_RETRIES
        )
        retried++
      } else {
        // Exhausted retries — mark as error
        await app.service('projects').patch(projectId, {
          status: 'error',
          errorMessage: 'Generation timed out. Please try again.',
          errorType: 'internal_error'
        })

        logger.warn(
          'cleanupStaleProjects: project %s exceeded max retries (%d) — marked as error',
          projectId,
          MAX_RETRIES
        )
        failed++
      }
    } catch (err: unknown) {
      logger.error(
        'cleanupStaleProjects: failed to process project %s: %s',
        projectId,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  logger.info(
    'cleanupStaleProjects: done — %d retried, %d failed',
    retried,
    failed
  )

  return { retried, failed }
}
