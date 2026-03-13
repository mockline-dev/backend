import { logger } from '../logger'
import { stopWorkerService } from '../services/redis'

export async function gracefulShutdown(signal?: string) {
  try {
    if (signal) logger.info(`${signal} received: shutting down gracefully...`)

    logger.info('Stopping notification service...')
    await stopWorkerService()

    logger.info('All services stopped gracefully ✅')
    process.exit(0)
  } catch (err) {
    logger.error('Error during graceful shutdown', err)
    process.exit(1)
  }
}
