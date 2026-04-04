import { Worker } from 'bullmq'
import { createModuleLogger } from '../../../logging'
import { orchestrate } from '../../../orchestration/pipeline/orchestrator'
import { createRouter } from '../../../orchestration/providers/router'
import { GroqProvider } from '../../../orchestration/providers/groq.provider'
import { getVectorStore } from '../../../orchestration/rag/chroma.client'
import { getRedisClient } from '../client'
import type { OrchestrationJobData } from '../queues/queues'

const log = createModuleLogger('orchestration-worker')

let orchestrationWorker: Worker | null = null

export function startOrchestrationWorker(app: any): Worker {
  if (orchestrationWorker) return orchestrationWorker

  const connection = getRedisClient()

  orchestrationWorker = new Worker<OrchestrationJobData>(
    'orchestration',
    async (job) => {
      const { projectId, userId, prompt, conversationHistory, model } = job.data

      log.info('Orchestration job started', { jobId: job.id, projectId, userId })

      try {
        // Update project status
        await app.service('projects').patch(projectId, {
          status: 'generating',
          'generationProgress.currentStage': 'orchestrating',
          'generationProgress.percentage': 5,
        }).catch(() => {/* non-fatal */})

        const llmConfig = app.get('llm')
        const router = createRouter(app)

        // Use a lightweight model for classification to save quota
        const classifierProvider = new GroqProvider({
          apiKey: llmConfig.groq.apiKey,
          defaultModel: llmConfig.groq.classifierModel,
        })

        const vectorStore = getVectorStore(app)

        // Emit Socket.IO events through the projects service channel
        const emit = (event: string, pid: string, payload: unknown) => {
          try {
            app.service('projects').emit(event, { projectId: pid, ...( payload as object) })
          } catch {/* non-fatal */}
        }

        const result = await orchestrate(
          { projectId, userId, prompt, conversationHistory, model },
          { router, classifierProvider, classifierModel: llmConfig.groq.classifierModel, vectorStore, app, emit }
        )

        // Update project with result
        await app.service('projects').patch(projectId, {
          status: 'ready',
          'generationProgress.percentage': 100,
          'generationProgress.currentStage': 'complete',
        }).catch(() => {/* non-fatal */})

        log.info('Orchestration job completed', { jobId: job.id, projectId, intent: result.intent })
        return result
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err))
        log.error('Orchestration job failed', { jobId: job.id, projectId, error: error.message })

        await app.service('projects').patch(projectId, {
          status: 'error',
          errorMessage: error.message,
        }).catch(() => {/* non-fatal */})

        throw err
      }
    },
    {
      connection: connection as any,
      concurrency: 3,
    }
  )

  orchestrationWorker.on('completed', (job) => {
    log.info('Job completed', { jobId: job.id })
  })

  orchestrationWorker.on('failed', (job, err) => {
    log.error('Job failed', { jobId: job?.id, error: err.message })
  })

  log.info('Orchestration worker started')
  return orchestrationWorker
}

export async function stopOrchestrationWorker(): Promise<void> {
  if (orchestrationWorker) {
    await orchestrationWorker.close()
    orchestrationWorker = null
    log.info('Orchestration worker stopped')
  }
}
