import { Job, Worker } from 'bullmq'

import { validateGeneratedFiles } from '../../../agent/validation/validator'
import { venvManager } from '../../../agent/validation/venv-manager'
import { app } from '../../../app'
import { logger } from '../../../logger'
import { r2Client } from '../../../storage/r2.client'
import { jobTracker } from '../queues/job-tracker'
import { redisConnection } from '../queues/queue.client'
import type { ValidationJobData } from '../queues/queues'

/**
 * Validation worker — concurrency=1 because the fix loop uses the LLM
 * (single-GPU constraint).
 *
 * Pipeline per job:
 *   1. Fetch requirements.txt from R2 (best-effort — used for venv pip install)
 *   2. Create/reuse a project venv
 *   3. Validate all .py files (py_compile → ruff → venv pyflakes)
 *   4. Run AI fix loop for failures (SEARCH/REPLACE, max 3 attempts/file)
 *   5. Write fixed files back to R2 + MongoDB
 *   6. Patch project generationProgress + broadcast result
 */
export const validationWorker = new Worker<ValidationJobData>(
  'code-validation',
  async (job: Job<ValidationJobData>) => {
    const { projectId, files } = job.data
    const jobId = job.id ?? 'unknown'

    jobTracker.registerJob(jobId, projectId, 10 * 60 * 1000)
    logger.info('Validation worker: starting for project %s (%d files)', projectId, files.length)

    try {
      await app.service('projects').patch(projectId, {
        generationProgress: { currentStage: 'validating' }
      } as never)

      // ── Step 1: Fetch requirements.txt for venv ─────────────────────────
      let requirementsTxt = ''
      try {
        requirementsTxt = await r2Client.getObject(`projects/${projectId}/requirements.txt`)
      } catch {
        logger.debug('Validation worker: requirements.txt not in R2 for project %s', projectId)
      }

      // ── Step 2: Create/reuse venv (best-effort, non-fatal) ──────────────
      if (requirementsTxt.trim()) {
        try {
          await venvManager.getOrCreate(projectId, requirementsTxt)
          logger.info('Validation worker: venv ready for project %s', projectId)
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          logger.warn(
            'Validation worker: venv creation failed for project %s (non-fatal): %s',
            projectId,
            msg.slice(0, 200)
          )
        }
      }

      // ── Step 3-4: Validate + fix loop ───────────────────────────────────
      const noop = async () => {}
      const summary = await validateGeneratedFiles(
        files,
        projectId,
        app,
        noop as never,
        venvManager.has(projectId) ? venvManager : undefined
      )

      // ── Step 5: Write fixed files back to R2 + MongoDB ──────────────────
      if (summary.fixedCount > 0) {
        const fixedFiles = files.filter(f => {
          const result = summary.results.find(r => r.path === f.path)
          return result?.wasFixed === true
        })

        for (const file of fixedFiles) {
          const key = `projects/${projectId}/${file.path}`
          try {
            await r2Client.putObject(key, file.content)

            // Update MongoDB file record size
            const existing = await app.service('files').find({
              query: { projectId, key, $limit: 1 }
            }) as { total: number; data: Array<{ _id: unknown }> }

            if (existing.total > 0) {
              await app.service('files').patch(existing.data[0]._id as string, {
                size: Buffer.byteLength(file.content),
                updatedAt: Date.now()
              })
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            logger.warn(
              'Validation worker: failed to write fixed file %s to R2: %s',
              file.path,
              msg
            )
          }
        }

        logger.info(
          'Validation worker: wrote %d fixed file(s) back to R2 for project %s',
          summary.fixedCount,
          projectId
        )
      }

      // ── Step 6: Broadcast result ────────────────────────────────────────
      app.channel(`projects/${projectId}`).send({
        type: 'validation:complete',
        payload: {
          passCount: summary.passCount,
          failCount: summary.failCount,
          fixedCount: summary.fixedCount,
          results: summary.results
        }
      })

      const progressStage =
        summary.failCount > 0
          ? 'validation_complete_with_warnings'
          : summary.fixedCount > 0
            ? 'validation_complete_with_fixes'
            : 'validation_complete'

      await app.service('projects').patch(projectId, {
        generationProgress: {
          currentStage: progressStage,
          validationResults: {
            passCount: summary.passCount,
            failCount: summary.failCount,
            fixedCount: summary.fixedCount,
            failedFiles: summary.results.filter(r => !r.valid).map(r => r.path),
            fixedFiles: summary.results.filter(r => r.wasFixed).map(r => r.path)
          }
        }
      } as never)

      if (summary.failCount > 0) {
        logger.warn(
          'Validation worker: %d/%d files still failing after fix loop for project %s',
          summary.failCount,
          files.length,
          projectId
        )
      } else {
        logger.info(
          'Validation worker: all files pass for project %s (%d fixed)',
          projectId,
          summary.fixedCount
        )
      }

      jobTracker.completeJob(jobId)
      return summary
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('Validation job %s failed: %s', jobId, msg)

      await app.service('projects').patch(projectId, {
        generationProgress: {
          currentStage: 'validation_error',
          validationError: msg
        }
      } as never)

      await jobTracker.cancelJob(jobId)
      throw err
    }
  },
  // concurrency=1 — fix loop uses the LLM (single-GPU constraint)
  { connection: redisConnection as never, concurrency: 1 }
)

validationWorker.on('failed', (job, err) => {
  const jobId = job?.id ?? 'unknown'
  logger.error('Validation job %s permanently failed: %s', jobId, err.message)

  if (job?.data?.projectId) {
    jobTracker.cancelJob(jobId).catch((e: unknown) => {
      logger.error('Failed to cleanup validation job %s: %s', jobId, String(e))
    })
  }
})

validationWorker.on('completed', job => {
  logger.info('Validation job %s completed successfully', job?.id ?? 'unknown')
})
