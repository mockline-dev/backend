import type { Worker } from 'bullmq'

import { logger } from '../../logger'
import { closeRedisClient, configureRedisClientFromApp, getRedisClient } from './client'
import { initBullBoard } from './monitor/monitor'

let generationWorker: Worker | null = null
let validationWorker: Worker | null = null
let agentWorker: Worker | null = null
let embeddingWorker: Worker | null = null
let deploymentWorker: Worker | null = null
let started = false

export async function startWorkerService(app: any) {
  if (started) return

  try {
    configureRedisClientFromApp(app)
    await getRedisClient()

    const generationModule = await import('./worker/generation.worker')
    const validationModule = await import('./worker/validation.worker')
    const agentModule = await import('./worker/agent.worker')
    const embeddingModule = await import('./worker/embedding.worker')
    const deploymentModule = await import('./worker/deployment.worker')
    generationWorker = generationModule.generationWorker
    validationWorker = validationModule.validationWorker
    agentWorker = agentModule.agentWorker
    embeddingWorker = embeddingModule.embeddingWorker
    deploymentWorker = deploymentModule.deploymentWorker

    await initBullBoard(app)
    started = true
    logger.info('Worker service started successfully')
  } catch (err) {
    logger.error('Failed to start worker service', err)
    await stopWorkerService()
    throw err
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

    if (agentWorker) {
      await agentWorker.close()
      agentWorker = null
    }

    if (embeddingWorker) {
      await embeddingWorker.close()
      embeddingWorker = null
    }

    if (deploymentWorker) {
      await deploymentWorker.close()
      deploymentWorker = null
    }

    await closeRedisClient()
    started = false
  } catch (err) {
    logger.error('Failed to stop worker service', err)
  }
}
