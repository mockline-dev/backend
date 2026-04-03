import type { Worker } from 'bullmq'

import { logger } from '../../logger'
import { closeRedisClient, configureRedisClientFromApp, getRedisClient } from './client'
import { initBullBoard } from './monitor/monitor'

let planningWorker: Worker | null = null
let generationWorker: Worker | null = null
let validationWorker: Worker | null = null
let editWorker: Worker | null = null
// Legacy workers (old queue names — kept for backward compatibility)
let legacyGenerationWorker: Worker | null = null
let legacyValidationWorker: Worker | null = null
let legacyEditWorker: Worker | null = null
let started = false

export async function startWorkerService(app: unknown) {
  if (started) return

  try {
    configureRedisClientFromApp(app)
    await getRedisClient()

    // New pipeline workers (planning → generation → validation)
    const planningModule = await import('./workers/planning.worker')
    const generationModule = await import('./workers/generation.worker')
    const validationModule = await import('./workers/validation.worker')
    const editModule = await import('./workers/edit.worker')

    planningWorker = planningModule.planningWorker
    generationWorker = generationModule.generationWorker
    validationWorker = validationModule.validationWorker
    editWorker = editModule.editWorker

    // Legacy workers (old queue names — kept for in-flight jobs)
    const legacyGenerationModule = await import('./worker/generation.worker')
    const legacyValidationModule = await import('./worker/validation.worker')
    const legacyEditModule = await import('./worker/edit.worker')

    legacyGenerationWorker = legacyGenerationModule.generationWorker
    legacyValidationWorker = legacyValidationModule.validationWorker
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
      editWorker,
      legacyGenerationWorker,
      legacyValidationWorker,
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
    editWorker = null
    legacyGenerationWorker = null
    legacyValidationWorker = null
    legacyEditWorker = null

    await closeRedisClient()
    started = false
    logger.info('Worker service stopped')
  } catch (err) {
    logger.error('Failed to stop worker service', err)
  }
}
