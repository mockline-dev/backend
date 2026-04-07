import type { Worker } from 'bullmq'

import { logger } from '../../logger'
import { closeRedisClient, configureRedisClientFromApp, getRedisClient } from './client'
import { initBullBoard } from './monitor/monitor'
import { startOrchestrationWorker, stopOrchestrationWorker } from './workers/orchestration.worker'
import { startIndexingWorker, stopIndexingWorker } from './workers/indexing.worker'
import { schedulePeriodicIndexing } from './jobs/indexing.job'

let orchestrationWorker: Worker | null = null
let indexingWorker: Worker | null = null
let started = false

export async function startWorkerService(app: any) {
  if (started) return

  try {
    configureRedisClientFromApp(app)
    await getRedisClient()
    await initBullBoard(app)

    orchestrationWorker = startOrchestrationWorker(app)
    indexingWorker = startIndexingWorker(app)

    // Schedule periodic merkle sync (every 5 minutes by default)
    const indexingConfig = app.get('indexing')
    if (indexingConfig?.enabled) {
      await schedulePeriodicIndexing(indexingConfig.periodicSyncIntervalMs ?? 300000)
    }

    started = true
    logger.info('Worker service started successfully')
  } catch (err) {
    logger.error('Failed to start worker service', err)
  }
}

export async function stopWorkerService() {
  try {
    await stopOrchestrationWorker()
    await stopIndexingWorker()

    await closeRedisClient()
    started = false
  } catch (err) {
    logger.error('Failed to stop worker service', err)
  }
}
