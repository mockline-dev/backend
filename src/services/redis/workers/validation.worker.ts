import { Job, Worker } from 'bullmq'

import { validateGeneratedFiles } from '../../../agent/validation/validator'
import { venvManager } from '../../../agent/validation/venv-manager'
import { classifyError } from '../../../agent/pipeline/error-utils'
import { PipelineTimer } from '../../../agent/pipeline/timing'
import { r2Client } from '../../../storage/r2.client'
import { createSnapshotWithR2 } from '../../snapshots/snapshots.class'
import { app } from '../../../app'
import { logger } from '../../../logger'
import { redisConnection } from '../queues/queue.client'
import type { ValidationJobData } from '../queues/validation.queue'
import type { ProjectsPatch } from '../../projects/projects.schema'
import { broadcastProgress } from './broadcast'

export const validationWorker = new Worker<ValidationJobData>(
  'validation',
  async (job: Job<ValidationJobData>) => {
    const { projectId } = job.data
    const jobId = job.id ?? 'unknown'
    const timer = new PipelineTimer()

    logger.info('Validation job %s started — project %s', jobId, projectId)

    try {
      timer.start('validation')
      // ── 1. Fetch all files from R2 ──────────────────────────────────────
      await job.updateProgress(5)
      const prefix = `projects/${projectId}/`
      const objects = await r2Client.listObjects(prefix)
      const pyObjects = objects.filter(o => o.key.endsWith('.py'))

      logger.info(
        'Validation job %s: found %d Python files in R2 for project %s',
        jobId,
        pyObjects.length,
        projectId
      )

      const fileResults = await Promise.all(
        pyObjects.map(async obj => {
          const relativePath = obj.key.replace(prefix, '')
          try {
            const content = await r2Client.getObject(obj.key)
            return { path: relativePath, content }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            logger.warn('Validation job %s: failed to fetch %s: %s', jobId, obj.key, msg)
            return null
          }
        })
      )

      const files = fileResults.filter(
        (f): f is { path: string; content: string } => f !== null
      )

      if (files.length === 0) {
        logger.warn('Validation job %s: no Python files found, skipping', jobId)
        await app.service('projects').patch(projectId, {
          status: 'ready',
          generationProgress: {
            currentStage: 'validation_skipped',
            percentage: 100,
            completedAt: Date.now()
          }
        } satisfies ProjectsPatch)
        return { passCount: 0, failCount: 0, fixedCount: 0 }
      }

      // ── 2. Update project status → validating ───────────────────────────
      await job.updateProgress(15)
      await app.service('projects').patch(projectId, {
        status: 'validating',
        generationProgress: {
          currentStage: 'validating',
          percentage: 15
        }
      } satisfies ProjectsPatch)

      app.channel(`projects/${projectId}`).send({
        type: 'validation:started',
        payload: { jobId, fileCount: files.length }
      })
      broadcastProgress(app, projectId, { phase: 'validation', step: 'started', detail: `Validating ${files.length} files`, percent: 15 })

      // ── Step: fetch requirements.txt for venv ────────────────────────────
      let requirementsTxt = ''
      try {
        requirementsTxt = await r2Client.getObject(`${prefix}requirements.txt`)
      } catch {
        logger.debug('Validation job %s: no requirements.txt in R2', jobId)
      }

      if (requirementsTxt.trim()) {
        try {
          await venvManager.getOrCreate(projectId, requirementsTxt)
          logger.info('Validation job %s: venv ready for project %s', jobId, projectId)
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          logger.warn('Validation job %s: venv creation failed (non-fatal): %s', jobId, msg)
        }
      }

      // ── 3. Execute validation pipeline (deterministic fix — no LLM calls) ─
      await job.updateProgress(20)
      const noop = async (_stage: string, _pct: number): Promise<void> => {}
      const summary = await validateGeneratedFiles(
        files,
        projectId,
        app,
        noop,
        venvManager.has(projectId) ? venvManager : undefined
      )

      // ── 4. If fixes applied: update files in R2 ──────────────────────────
      const fixedOrStubbed = summary.results.filter(r => r.wasFixed)
      if (fixedOrStubbed.length > 0) {
        await job.updateProgress(85)

        for (const result of fixedOrStubbed) {
          const file = files.find(f => f.path === result.path)
          if (!file) continue

          const key = `${prefix}${file.path}`
          try {
            await r2Client.putObject(key, file.content)

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
            logger.warn('Validation job %s: failed to write fixed file %s: %s', jobId, file.path, msg)
          }
        }

        logger.info(
          'Validation job %s: wrote %d fixed/stubbed files back to R2',
          jobId,
          fixedOrStubbed.length
        )
      }

      // Record validation run
      try {
        await app.service('validation-runs').create({
          projectId,
          round: 1,
          passed: summary.failCount === 0,
          errors: summary.results
            .filter(r => !r.valid)
            .flatMap(r =>
              (r.errors ?? []).map(e => ({
                file: r.path,
                line: e.line,
                message: e.message,
                tool: e.code
              }))
            ),
          fixesApplied: summary.results
            .filter(r => r.wasFixed)
            .map(r => r.path)
        } as never)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.warn('Validation job %s: failed to record validation run: %s', jobId, msg)
      }

      // ── 5. Always mark project as ready ──────────────────────────────────
      await job.updateProgress(95)

      const currentStage = summary.failCount === 0
        ? 'validation_complete'
        : 'validation_complete_with_warnings'

      const failedFiles = summary.results.filter(r => !r.valid).map(r => r.path)

      await app.service('projects').patch(projectId, {
        status: 'ready',
        generationProgress: {
          currentStage,
          percentage: 100,
          completedAt: Date.now(),
          validationResults: {
            passCount: summary.passCount,
            failCount: summary.failCount,
            failedFiles,
            fixedCount: summary.fixedCount,
            fixedFiles: summary.results.filter(r => r.wasFixed).map(r => r.path)
          }
        }
      } satisfies ProjectsPatch)

      // Always create snapshot (even when warnings remain)
      try {
        const snapshotResult = await app.service('snapshots').find({
          query: { projectId, $limit: 0 }
        }) as { total: number }
        await createSnapshotWithR2(app, {
          projectId,
          version: snapshotResult.total + 1,
          label: summary.stubbedCount > 0 ? 'Post-validation snapshot (with stubs)' : 'Post-validation snapshot',
          trigger: 'auto-generation'
        })
      } catch (snapErr: unknown) {
        const msg = snapErr instanceof Error ? snapErr.message : String(snapErr)
        logger.warn('Validation job %s: snapshot creation failed: %s', jobId, msg)
      }

      // Emit validation:summary for frontend stats
      app.channel(`projects/${projectId}`).send({
        type: 'validation:summary',
        payload: {
          filesValidated: files.length,
          filesPassed: summary.passCount,
          filesAutoFixed: summary.fixedCount,
          filesStubbed: summary.stubbedCount,
          warningsAccepted: summary.warnings.length
        }
      })

      app.channel(`projects/${projectId}`).send({
        type: 'validation:complete',
        payload: {
          passed: true,
          passCount: summary.passCount,
          failCount: summary.failCount,
          fixedCount: summary.fixedCount,
          stubbedCount: summary.stubbedCount,
          failedFiles
        }
      })
      broadcastProgress(app, projectId, {
        phase: 'validation',
        step: 'complete',
        detail: `${summary.passCount} files ready (${summary.fixedCount} auto-fixed, ${summary.stubbedCount} stubbed)`,
        percent: 100
      })

      await job.updateProgress(100)
      logger.info(
        'Validation job %s complete — project %s ready: %d passed, %d fixed, %d stubbed, %d warnings (total=%dms)',
        jobId,
        projectId,
        summary.passCount,
        summary.fixedCount,
        summary.stubbedCount,
        summary.warnings.length,
        timer.end('validation')
      )
      return summary
    } catch (err: unknown) {
      const { message, category } = classifyError(err)
      logger.error('Validation job %s failed (project %s): %s', jobId, projectId, err instanceof Error ? err.message : String(err))

      await app.service('projects').patch(projectId, {
        status: 'error',
        errorMessage: message,
        errorType: category,
        generationProgress: {
          currentStage: 'validation_error',
          errorMessage: message,
          failedAt: Date.now()
        }
      } satisfies ProjectsPatch)

      throw err
    }
  },
  // concurrency=1 — deterministic fix — no LLM calls, but sequential for consistency
  { connection: redisConnection as never, concurrency: 1, lockDuration: 300_000 }
)

validationWorker.on('failed', (job, err) => {
  logger.error('Validation job %s permanently failed: %s', job?.id ?? 'unknown', err.message)
})

validationWorker.on('completed', job => {
  logger.info('Validation job %s completed', job?.id ?? 'unknown')
})

process.on('SIGTERM', () => {
  validationWorker.close().catch(() => {})
})
