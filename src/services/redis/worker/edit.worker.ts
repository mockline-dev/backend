import { Job, Worker } from 'bullmq'

import { AgentEngine } from '../../../agent/engine'
import type { AgentEvent } from '../../../agent/engine'
import { buildEditSystemPrompt } from '../../../llm/prompts/edit.prompts'
import { app } from '../../../app'
import { logger } from '../../../logger'
import { r2Client } from '../../../storage/r2.client'
import { redisConnection } from '../queues/queue.client'
import { validationQueue } from '../queues/queues'
import type { EditJobData } from '../queues/queues'
import type { ProjectsPatch } from '../../projects/projects.schema'
import type { ConversationsPatch, ConversationsData } from '../../conversations/conversations.schema'

const MAX_AGENT_ITERATIONS = 15

type ConvMessage = {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCall?: { name: string; args: Record<string, unknown> }
  toolResult?: { success: boolean; data?: unknown; error?: string }
  timestamp: number
}

export const editWorker = new Worker<EditJobData>(
  'code-edit',
  async (job: Job<EditJobData>) => {
    const { projectId, userId, message, conversationId } = job.data
    const jobId = job.id ?? 'unknown'

    logger.info('Edit job %s started — project %s', jobId, projectId)

    // ------------------------------------------------------------------
    // 1. Verify project ownership
    // ------------------------------------------------------------------
    let project: Record<string, unknown>
    try {
      project = await app.service('projects').get(projectId)
    } catch {
      throw new Error(`Project ${projectId} not found`)
    }

    if (project.userId?.toString() !== userId) {
      throw new Error('Forbidden: project does not belong to this user')
    }

    // ------------------------------------------------------------------
    // 2. Patch project status → editing
    // ------------------------------------------------------------------
    await job.updateProgress(5)
    await app.service('projects').patch(projectId, {
      status: 'editing',
      editProgress: { stage: 'starting', percentage: 0, startedAt: Date.now() }
    } satisfies ProjectsPatch)

    const broadcast = (type: string, payload: Record<string, unknown>) => {
      app.channel(`projects/${projectId}`).send({ type, payload })
    }

    broadcast('edit:started', { jobId, message })

    // ------------------------------------------------------------------
    // 3. Pre-edit snapshot
    // ------------------------------------------------------------------
    try {
      // Snapshot service hook computes version/files/r2Prefix from projectId+label+trigger
      await (app.service('snapshots').create as Function)({
        projectId,
        label: `Before edit: ${message.slice(0, 60)}`,
        trigger: 'auto-ai-edit'
      })
      broadcast('edit:snapshot', { stage: 'pre-edit snapshot created' })
    } catch (snapErr: unknown) {
      const msg = snapErr instanceof Error ? snapErr.message : String(snapErr)
      logger.warn('Edit job %s: pre-edit snapshot failed: %s', jobId, msg)
    }

    // ------------------------------------------------------------------
    // 4. Load conversation history (if resuming)
    // ------------------------------------------------------------------
    let history: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }> = []
    let existingConvMessages: ConvMessage[] = []

    if (conversationId) {
      try {
        const conv = await app.service('conversations').get(conversationId)
        existingConvMessages = Array.isArray(conv.messages) ? (conv.messages as ConvMessage[]) : []
        history = existingConvMessages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
      } catch {
        logger.warn('Edit job %s: could not load conversation %s', jobId, conversationId)
      }
    }

    // ------------------------------------------------------------------
    // 5. Run AgentEngine
    // ------------------------------------------------------------------
    await job.updateProgress(10)
    const systemPrompt = buildEditSystemPrompt(project)
    const engine = new AgentEngine(app)

    const agentMessages: ConvMessage[] = [
      { role: 'user', content: message, timestamp: Date.now() }
    ]

    let iteration = 0

    await engine.run({
      projectId,
      systemPrompt,
      userMessage: message,
      history,
      maxIterations: MAX_AGENT_ITERATIONS,
      onEvent: (event: AgentEvent) => {
        switch (event.type) {
          case 'token':
            broadcast('edit:token', { content: event.payload })
            break

          case 'tool_call': {
            iteration++
            const pct = Math.min(10 + iteration * 5, 90)
            job.updateProgress(pct).catch(() => {})
            broadcast('edit:iteration', {
              iteration,
              tool: event.payload.name,
              args: event.payload.args,
              percentage: pct
            })
            app.service('projects').patch(projectId, {
              editProgress: { stage: `tool:${event.payload.name}`, percentage: pct }
            } satisfies ProjectsPatch).catch(() => {})
            agentMessages.push({
              role: 'assistant',
              content: '',
              toolCall: { name: event.payload.name, args: event.payload.args },
              timestamp: Date.now()
            })
            break
          }

          case 'tool_result':
            broadcast('edit:tool_result', {
              tool: event.payload.name,
              success: event.payload.result?.success ?? false
            })
            agentMessages.push({
              role: 'tool',
              content: JSON.stringify(event.payload.result),
              toolResult: event.payload.result,
              timestamp: Date.now()
            })
            break

          case 'done':
            agentMessages.push({
              role: 'assistant',
              content: event.payload.summary,
              timestamp: Date.now()
            })
            break

          case 'error':
            logger.error('Edit job %s agent error: %s', jobId, event.payload.message)
            break
        }
      }
    })

    // ------------------------------------------------------------------
    // 6. Persist / update conversation
    // ------------------------------------------------------------------
    await job.updateProgress(92)
    try {
      if (conversationId && existingConvMessages.length > 0) {
        await app.service('conversations').patch(conversationId, {
          messages: [...existingConvMessages, ...agentMessages],
          updatedAt: Date.now()
        } satisfies ConversationsPatch)
      } else {
        await app.service('conversations').create({
          projectId,
          userId,
          title: message.slice(0, 80),
          messages: agentMessages
        } satisfies ConversationsData)
      }
    } catch (convErr: unknown) {
      const msg = convErr instanceof Error ? convErr.message : String(convErr)
      logger.warn('Edit job %s: failed to save conversation: %s', jobId, msg)
    }

    // ------------------------------------------------------------------
    // 7. Patch project status → ready
    // ------------------------------------------------------------------
    await app.service('projects').patch(projectId, {
      status: 'ready',
      editProgress: {
        stage: 'complete',
        percentage: 100,
        completedAt: Date.now(),
        iterations: iteration
      }
    } satisfies ProjectsPatch)

    const lastAssistant = [...agentMessages].reverse().find(m => m.role === 'assistant')
    const summary = lastAssistant?.content ?? ''
    broadcast('edit:complete', { jobId, summary, iterations: iteration })
    logger.info('Edit job %s completed — %d tool iterations', jobId, iteration)

    // ------------------------------------------------------------------
    // 8. Post-edit validation (fire-and-forget)
    //    Plan: "On done() → create snapshot + validate + complete"
    //    Gather all Python files from R2 and enqueue a validation job.
    // ------------------------------------------------------------------
    triggerPostEditValidation(projectId, jobId, broadcast).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('Edit job %s: failed to enqueue post-edit validation: %s', jobId, msg)
    })

    await job.updateProgress(100)
    return { iterations: iteration, summary }
  },
  { connection: redisConnection as never, concurrency: 1 }
)

editWorker.on('failed', (job, err) => {
  const jobId = job?.id ?? 'unknown'
  const projectId = job?.data?.projectId
  logger.error('Edit job %s permanently failed: %s', jobId, err.message)

  if (projectId) {
    app
      .service('projects')
      .patch(projectId, {
        status: 'ready',
        editProgress: { stage: 'error', percentage: 0, errorMessage: err.message }
      } satisfies ProjectsPatch)
      .catch((patchErr: unknown) => {
        const msg = patchErr instanceof Error ? patchErr.message : String(patchErr)
        logger.error('Edit job %s: failed to reset project status: %s', jobId, msg)
      })
  }
})

editWorker.on('completed', job => {
  logger.info('Edit job %s completed successfully', job?.id ?? 'unknown')
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Gather all Python files from R2 and enqueue a validation job.
 * Non-blocking — called after project status is already 'ready'.
 */
async function triggerPostEditValidation(
  projectId: string,
  editJobId: string,
  broadcast: (type: string, payload: Record<string, unknown>) => void
): Promise<void> {
  const prefix = `projects/${projectId}/`
  const objects = await r2Client.listObjects(prefix)
  const pyPaths = objects
    .map(o => o.key.replace(prefix, ''))
    .filter(p => p.endsWith('.py'))
    .slice(0, 50)

  if (pyPaths.length === 0) {
    logger.debug('Edit job %s: no Python files found, skipping post-edit validation', editJobId)
    return
  }

  const fileResults = await Promise.all(
    pyPaths.map(async path => {
      try {
        const content = await r2Client.getObject(`${prefix}${path}`)
        return { path, content }
      } catch {
        return null
      }
    })
  )

  const files = fileResults.filter(
    (f): f is { path: string; content: string } => f !== null
  )

  const validationJob = await validationQueue.add(
    'validate',
    { projectId, files },
    { attempts: 1, removeOnComplete: true, removeOnFail: false }
  )

  broadcast('edit:validating', {
    jobId: validationJob.id,
    fileCount: files.length,
    message: `Validating ${files.length} Python files…`
  })

  logger.info(
    'Edit job %s: enqueued post-edit validation %s (%d files)',
    editJobId,
    validationJob.id,
    files.length
  )
}
