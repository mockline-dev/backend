import type { Worker } from 'bullmq'

import type { Application } from '../../declarations'
import { logger } from '../../logger'
import { closeRedisClient, configureRedisClientFromApp, getRedisClient } from './client'
import { initBullBoard } from './monitor/monitor'
import { jobTracker } from './queues/job-tracker'

let planningWorker: Worker | null = null
let generationWorker: Worker | null = null
let validationWorker: Worker | null = null
let legacyEditWorker: Worker | null = null
let started = false

export async function startWorkerService(app: unknown) {
  if (started) return

  try {
    configureRedisClientFromApp(app)
    await getRedisClient()

    // Wire app into job tracker so cleanup can remove MongoDB records
    jobTracker.setApp(app as Application)

    // New pipeline workers (planning → generation → validation)
    const planningModule = await import('./workers/planning.worker')
    const generationModule = await import('./workers/generation.worker')
    const validationModule = await import('./workers/validation.worker')

    planningWorker = planningModule.planningWorker
    generationWorker = generationModule.generationWorker
    validationWorker = validationModule.validationWorker

    // Legacy edit worker (handles code-edit queue — still used by /ai-edit endpoint)
    const legacyEditModule = await import('./worker/edit.worker')
    legacyEditWorker = legacyEditModule.editWorker

    await initBullBoard(app)
    started = true
    logger.info('Worker service started successfully (planning + generation + validation + edit)')
  } catch (err) {
    logger.error('Failed to start worker service', err)
  }
}

export async function stopWorkerService() {
  try {
    const workers = [
      planningWorker,
      generationWorker,
      validationWorker,
      legacyEditWorker
    ]

    await Promise.all(
      workers
        .filter((w): w is Worker => w !== null)
        .map(w => w.close())
    )

    planningWorker = null
    generationWorker = null
    validationWorker = null
    legacyEditWorker = null

    await closeRedisClient()
    started = false
    logger.info('Worker service stopped')
  } catch (err) {
    logger.error('Failed to stop worker service', err)
  }
}

