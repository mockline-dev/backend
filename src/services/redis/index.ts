import type { Worker } from 'bullmq'

import { logger } from '../../logger'
import { closeRedisClient, configureRedisClientFromApp, getRedisClient } from './client'
import { initBullBoard } from './monitor/monitor'

let generationWorker: Worker | null = null
let validationWorker: Worker | null = null
let started = false

export async function startWorkerService(app: any) {
  if (started) return

  try {
    configureRedisClientFromApp(app)
    await getRedisClient()
    await initBullBoard(app)
    started = true
    logger.info('Worker service started successfully')
  } catch (err) {
    logger.error('Failed to start worker service', err)
  }
}

export async function stopWorkerService() {
  try {
    if (generationWorker) {
      await generationWorker.close()
      generationWorker = null
    }

    if (validationWorker) {
      await validationWorker.close()
      validationWorker = null
    }

    await closeRedisClient()
    started = false
  } catch (err) {
    logger.error('Failed to stop worker service', err)
  }
}
