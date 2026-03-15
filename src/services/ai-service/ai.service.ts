import { BadRequest, Forbidden, NotFound } from '@feathersjs/errors'
import { rateLimit } from '../../hooks/rate-limit'
import { ollamaClient } from '../../llm/ollama.client'
import { logger } from '../../logger'
import { generationQueue } from '../redis/queues/queues'

export default function (app: any) {
  /**
   * Enqueue a code generation job for a project.
   * Returns immediately — actual generation runs in a BullMQ worker.
   */
  app
    .use('/ai-service', {
      async create(data: { projectId: string; prompt: string }, params: any) {
        const { projectId, prompt } = data
        const userId = params.user?._id?.toString()

        if (!prompt?.trim()) {
          throw new BadRequest('Prompt is required')
        }

        if (!projectId) {
          throw new BadRequest('Project ID is required')
        }

        let project: any
        try {
          project = await app.service('projects').get(projectId)
        } catch {
          throw new NotFound('Project not found')
        }

        if (project.userId?.toString() !== userId) {
          throw new Forbidden('Not your project')
        }

        if (!['initializing', 'error'].includes(project.status)) {
          throw new BadRequest(`Cannot generate from status: ${project.status}`)
        }

        const ollamaConfig = app.get('ollama')

        const job = await generationQueue.add(
          'generate',
          { projectId, prompt, userId, model: ollamaConfig.model },
          {
            attempts: 1,
            removeOnComplete: false,
            removeOnFail: false
          }
        )

        await app.service('projects').patch(projectId, {
          status: 'generating',
          jobId: job.id?.toString(),
          generationProgress: {
            percentage: 0,
            currentStage: 'Queued',
            filesGenerated: 0,
            totalFiles: 0,
            startedAt: Date.now()
          }
        })

        logger.info('Generation job enqueued %O', { projectId, userId, jobId: job.id })

        return { jobId: job.id, status: 'generating' }
      },

      async find(_params: any) {
        const healthy = await ollamaClient.healthCheck()
        return {
          service: 'ai-generator',
          status: healthy ? 'running' : 'degraded',
          ollama: { reachable: healthy },
          model: app.get('ollama').model
        }
      }
    })
    .hooks({
      before: {
        create: [
          rateLimit({
            windowSeconds: 3600,
            maxRequests: 10,
            keyPrefix: 'generation'
          })
        ]
      }
    })
}
