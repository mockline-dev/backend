import { Job, Worker } from 'bullmq'

import { app } from '../../../app'
import { logger } from '../../../logger'
import { redisConnection } from '../queues/queue.client'
import type { EmbeddingJobData } from '../queues/queues'

export const embeddingWorker = new Worker<EmbeddingJobData>(
  'embedding-tasks',
  async (job: Job<EmbeddingJobData>) => {
    const { projectId, files } = job.data

    // Placeholder for production vector embedding integration (Qdrant/Redis Vector)
    // Stores lightweight embedding metadata for deterministic auditability.
    await app.service('prompts').create({
      projectId,
      kind: 'embedding_batch',
      content: JSON.stringify({
        fileCount: files.length,
        paths: files.map(file => file.path),
        generatedAt: Date.now()
      }),
      createdAt: Date.now(),
      updatedAt: Date.now()
    } as any)

    app.channel(`projects/${projectId}`).send({
      type: 'embedding.completed',
      payload: {
        projectId,
        fileCount: files.length,
        completedAt: Date.now()
      }
    })

    return {
      embeddedFiles: files.length
    }
  },
  { connection: redisConnection as any, concurrency: 2 }
)

embeddingWorker.on('failed', (_job, error) => {
  logger.error('Embedding job failed: %s', error.message)
})
