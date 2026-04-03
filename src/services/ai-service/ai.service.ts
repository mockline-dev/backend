import { authenticate } from '@feathersjs/authentication'
import { BadRequest, Forbidden, NotFound } from '@feathersjs/errors'
import { rateLimit } from '../../hooks/rate-limit'
import { ollamaClient } from '../../llm/ollama.client'
import { logger } from '../../logger'
import { planningQueue } from '../redis/queues/planning.queue'
import { editQueue } from '../redis/queues/queues'

export default function (app: any) {
  /**
   * Enqueue a code generation job for a project.
   * Returns immediately — actual generation runs in a BullMQ worker.
   */
  app.use('/ai-service', {
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

      if (!['created', 'initializing', 'error'].includes(project.status)) {
        throw new BadRequest(`Cannot generate from status: ${project.status}`)
      }

      const job = await planningQueue.add(
        'plan',
        { projectId, userPrompt: prompt },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: false,
          removeOnFail: false
        }
      )

      await app.service('projects').patch(projectId, {
        status: 'planning',
        jobId: job.id?.toString(),
        generationProgress: {
          percentage: 0,
          currentStage: 'queued',
          filesGenerated: 0,
          totalFiles: 0,
          startedAt: Date.now()
        }
      })

      logger.info('Planning job enqueued %O', { projectId, userId, jobId: job.id })

      return { jobId: job.id, status: 'queued' }
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

  app.service('ai-service').hooks({
    before: {
      create: [
        authenticate('jwt'),
        rateLimit({
          windowSeconds: 3600,
          maxRequests: 10,
          keyPrefix: 'generation'
        })
      ]
    }
  })

  /**
   * Enqueue an agentic edit job for an existing project.
   * Triggers the edit worker which runs the AgentEngine tool loop.
   */
  app.use('/ai-edit', {
    async create(data: { projectId: string; message: string; conversationId?: string }, params: any) {
      const { projectId, message, conversationId } = data
      const userId = params.user?._id?.toString()

      if (!projectId) throw new BadRequest('projectId is required')
      if (!message?.trim()) throw new BadRequest('message is required')

      let project: any
      try {
        project = await app.service('projects').get(projectId)
      } catch {
        throw new NotFound('Project not found')
      }

      if (project.userId?.toString() !== userId) {
        throw new Forbidden('Not your project')
      }

      if (!['ready', 'error'].includes(project.status)) {
        throw new BadRequest(`Project must be in 'ready' state to edit (current: ${project.status})`)
      }

      const job = await editQueue.add(
        'edit',
        { projectId, message, userId, conversationId },
        {
          attempts: 1,
          removeOnComplete: false,
          removeOnFail: false
        }
      )

      logger.info('Edit job enqueued %O', { projectId, userId, jobId: job.id })

      return { jobId: job.id, status: 'editing' }
    }
  })

  app.service('ai-edit').hooks({
    before: {
      create: [authenticate('jwt'), rateLimit({ windowSeconds: 60, maxRequests: 20, keyPrefix: 'edit' })]
    }
  })
}
