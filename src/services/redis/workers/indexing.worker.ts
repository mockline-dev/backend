import { Worker } from 'bullmq'
import { createModuleLogger } from '../../../logging'
import { getVectorStore } from '../../../orchestration/rag/chroma.client'
import { syncProjectIndex } from '../../../orchestration/merkle/sync'
import { createMerkleTreeStore } from '../../../orchestration/merkle/store'
import { getRedisClient, getRedisClientSync } from '../client'
import type { IndexingJobData } from '../queues/queues'

const log = createModuleLogger('indexing-worker')

let indexingWorker: Worker | null = null

export function startIndexingWorker(app: any): Worker {
  if (indexingWorker) return indexingWorker

  const connection = getRedisClient()

  indexingWorker = new Worker<IndexingJobData>(
    'indexing',
    async job => {
      const { projectId } = job.data

      if (!projectId) {
        log.debug('Periodic sync job — no specific projectId, skipping (not yet implemented)')
        return
      }

      log.info('Indexing job started', { jobId: job.id, projectId })

      try {
        const vectorStore = getVectorStore(app)
        const redis = getRedisClientSync()
        const store = await createMerkleTreeStore(app, redis)

        const result = await syncProjectIndex(projectId, app, vectorStore, store)

        const { changes, indexed, removed } = result
        log.info('Indexing job complete', {
          jobId: job.id,
          projectId,
          added: changes.added.length,
          modified: changes.modified.length,
          deleted: changes.deleted.length,
          indexed,
          removed
        })

        // Emit sync result to connected clients
        app.service('projects').emit('indexing:completed', {
          projectId,
          indexed,
          removed,
          changes: {
            added: changes.added.length,
            modified: changes.modified.length,
            deleted: changes.deleted.length
          }
        })

        return result
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err))
        log.error('Indexing job failed', { jobId: job.id, projectId, error: error.message })

        app.service('projects').emit('indexing:error', { projectId, error: error.message })
        throw err
      }
    },
    {
      connection: connection as any,
      concurrency: 1 // single-threaded: ChromaDB can't handle concurrent bulk writes well
    }
  )

  indexingWorker.on('completed', job => {
    log.info('Job completed', { jobId: job.id })
  })

  indexingWorker.on('failed', (job, err) => {
    log.error('Job failed', { jobId: job?.id, error: err.message })
  })

  log.info('Indexing worker started')
  return indexingWorker
}

export async function stopIndexingWorker(): Promise<void> {
  if (indexingWorker) {
    await indexingWorker.close()
    indexingWorker = null
    log.info('Indexing worker stopped')
  }
}
