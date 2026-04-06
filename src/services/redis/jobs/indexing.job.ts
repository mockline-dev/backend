import { createModuleLogger } from '../../../logging'
import { indexingQueue } from '../queues/queues'

const log = createModuleLogger('indexing-job')

/**
 * Register a BullMQ repeatable job that periodically triggers a sync
 * for all projects whose merkle tree is stale.
 *
 * Called once at app start from startWorkerService().
 * Safe to call multiple times — BullMQ deduplicates by repeat key.
 */
export async function schedulePeriodicIndexing(intervalMs: number): Promise<void> {
  try {
    await indexingQueue.add(
      'periodic-sync',
      { projectId: undefined },
      {
        repeat: { every: intervalMs },
        removeOnComplete: true,
        removeOnFail: 10,
      }
    )
    log.info('Periodic indexing job scheduled', { intervalMs })
  } catch (err) {
    log.warn('Failed to schedule periodic indexing job (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
