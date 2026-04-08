import { Worker } from 'bullmq'
import { createModuleLogger } from '../../../logging'
import { orchestrate } from '../../../orchestration/pipeline/orchestrator'
import { persistFiles } from '../../../orchestration/pipeline/persist-files'
import { createRouter } from '../../../orchestration/providers/router'
import { GroqProvider } from '../../../orchestration/providers/groq.provider'
import { getVectorStore } from '../../../orchestration/rag/chroma.client'
import { Intent } from '../../../orchestration/types'
import { runSandbox, buildFixPrompt } from '../../../orchestration/sandbox/sandbox'
import { OpenSandboxProvider } from '../../../orchestration/sandbox/providers/opensandbox.provider'
import { detectPrimaryLanguage, extractCodeBlocks } from '../../../orchestration/sandbox/code-extractor'
import { indexingQueue } from '../queues/queues'
import { jobTracker } from '../queues/job-tracker'
import { getRedisClient } from '../client'
import type { OrchestrationJobData } from '../queues/queues'

const log = createModuleLogger('orchestration-worker')

const CODE_INTENTS = new Set([Intent.GenerateProject, Intent.EditCode, Intent.FixBug, Intent.AddFeature])

let orchestrationWorker: Worker | null = null

export function startOrchestrationWorker(app: any): Worker {
  if (orchestrationWorker) return orchestrationWorker

  const connection = getRedisClient()

  orchestrationWorker = new Worker<OrchestrationJobData>(
    'orchestration',
    async job => {
      const { projectId, userId, prompt, conversationHistory, model, messageId } = job.data

      log.info('Orchestration job started', { jobId: job.id, projectId, userId })
      jobTracker.registerJob(job.id!, projectId)

      try {
        // Update project status
        await app
          .service('projects')
          .patch(projectId, {
            status: 'generating',
            generationProgress: { currentStage: 'orchestrating', percentage: 5 }
          })
          .catch((err: unknown) => {
            log.warn('Failed to update project status to generating', {
              projectId,
              error: err instanceof Error ? err.message : String(err)
            })
          })

        const llmConfig = app.get('llm')
        const router = createRouter(app)

        const classifierProvider = new GroqProvider({
          apiKey: llmConfig.groq.apiKey,
          defaultModel: llmConfig.groq.classifierModel
        })

        const vectorStore = getVectorStore(app)

        const emit = (event: string, pid: string, payload: unknown) => {
          try {
            app.service('projects').emit(event, { projectId: pid, ...(payload as object) })
          } catch (e: unknown) {
            log.debug('Failed to emit event', { event, error: e instanceof Error ? e.message : String(e) })
          }
        }

        // ── Step 1: Run the orchestration pipeline ────────────────────────────
        // (includes intent classification, prompt enhancement, RAG, LLM streaming)
        let result = await orchestrate(
          { projectId, userId, prompt, conversationHistory, model, messageId },
          {
            router,
            classifierProvider,
            classifierModel: llmConfig.groq.classifierModel,
            vectorStore,
            app,
            emit
          }
        )

        // ── Step 2: Sandbox validation (blocking, code intents only) ──────────
        const sandboxConfig = app.get('sandbox')
        let sandboxFiles = extractCodeBlocks(result.content)

        if (CODE_INTENTS.has(result.intent) && sandboxConfig?.opensandbox?.apiKey) {
          if (sandboxFiles.length > 0) {
            const language = detectPrimaryLanguage(sandboxFiles)
            const provider = new OpenSandboxProvider(sandboxConfig.opensandbox)
            const maxRetries = sandboxConfig.maxRetries ?? 2

            let { result: sandboxResult } = await runSandbox(result.content, provider, emit, projectId, {
              timeoutMs: sandboxConfig.timeoutMs,
              language,
              runTests: false
            })

            // Agentic fix loop
            let retries = 0
            while (!sandboxResult.success && retries < maxRetries) {
              retries++
              emit('sandbox:retry', projectId, {
                attempt: retries,
                error: sandboxResult.compilationOutput ?? sandboxResult.stderr
              })

              const fixPrompt = buildFixPrompt(result.content, sandboxResult)
              const fixResult = await orchestrate(
                { projectId, userId, prompt: fixPrompt, conversationHistory, model },
                {
                  router,
                  classifierProvider,
                  classifierModel: llmConfig.groq.classifierModel,
                  vectorStore,
                  app,
                  emit
                }
              )
              result = fixResult
              sandboxFiles = extractCodeBlocks(result.content)

              const retryRun = await runSandbox(result.content, provider, emit, projectId, {
                timeoutMs: sandboxConfig.timeoutMs,
                language,
                runTests: false
              })
              sandboxResult = retryRun.result
            }

            emit('sandbox:result', projectId, {
              success: sandboxResult.success,
              syntaxValid: sandboxResult.syntaxValid,
              compilationOutput: sandboxResult.compilationOutput,
              durationMs: sandboxResult.durationMs
            })

            // ── Step 3: Persist validated files to R2 ─────────────────────────
            if (sandboxFiles.length > 0) {
              await app
                .service('projects')
                .patch(projectId, {
                  generationProgress: { currentStage: 'persisting', percentage: 85 }
                })
                .catch((err: unknown) => {
                  log.warn('Failed to update progress to persisting', {
                    projectId,
                    error: err instanceof Error ? err.message : String(err)
                  })
                })

              const { fileIds, snapshotId, uploadedCount } = await persistFiles(
                projectId,
                sandboxFiles,
                messageId ?? null,
                app
              )
              sandboxFiles.forEach(f => jobTracker.trackR2Key(job.id!, `projects/${projectId}/${f.path}`))

              emit('files:persisted', projectId, {
                fileIds,
                snapshotId,
                uploadedCount,
                filePaths: sandboxFiles.map(f => f.path)
              })

              await app
                .service('projects')
                .patch(projectId, {
                  generationProgress: { filesGenerated: uploadedCount }
                })
                .catch((err: unknown) => {
                  log.warn('Failed to update filesGenerated count', {
                    projectId,
                    error: err instanceof Error ? err.message : String(err)
                  })
                })

              // ── Step 4: Save assistant message with result metadata ──────────
              await app
                .service('messages')
                .create(
                  {
                    projectId,
                    role: 'assistant',
                    content: result.content,
                    intent: result.intent,
                    model: result.model,
                    metadata: {
                      usage: result.usage,
                      sandboxResult: {
                        success: sandboxResult.success,
                        durationMs: sandboxResult.durationMs
                      },
                      filesGenerated: sandboxFiles.map(f => f.path),
                      ...(result.enhancedPrompt ? { enhancedPrompt: result.enhancedPrompt } : {})
                    }
                  },
                  { provider: undefined }
                )
                .catch((err: unknown) => {
                  log.warn('Failed to save assistant message', {
                    projectId,
                    error: err instanceof Error ? err.message : String(err)
                  })
                })
            }
          }
        } else if (CODE_INTENTS.has(result.intent) && sandboxFiles.length > 0) {
          // No sandbox API key — persist files without validation
          const { fileIds, snapshotId, uploadedCount } = await persistFiles(
            projectId,
            sandboxFiles,
            messageId ?? null,
            app
          )
          sandboxFiles.forEach(f => jobTracker.trackR2Key(job.id!, `projects/${projectId}/${f.path}`))

          emit('files:persisted', projectId, {
            fileIds,
            snapshotId,
            uploadedCount,
            filePaths: sandboxFiles.map(f => f.path)
          })

          await app
            .service('messages')
            .create(
              {
                projectId,
                role: 'assistant',
                content: result.content,
                intent: result.intent,
                model: result.model,
                metadata: {
                  usage: result.usage,
                  filesGenerated: sandboxFiles.map(f => f.path),
                  ...(result.enhancedPrompt ? { enhancedPrompt: result.enhancedPrompt } : {})
                }
              },
              { provider: undefined }
            )
            .catch((err: unknown) => {
              log.warn('Failed to save assistant message', {
                projectId,
                error: err instanceof Error ? err.message : String(err)
              })
            })
        } else {
          // Non-code intent — save assistant message without files
          await app
            .service('messages')
            .create(
              {
                projectId,
                role: 'assistant',
                content: result.content,
                intent: result.intent,
                model: result.model,
                metadata: {
                  usage: result.usage,
                  ...(result.enhancedPrompt ? { enhancedPrompt: result.enhancedPrompt } : {})
                }
              },
              { provider: undefined }
            )
            .catch((err: unknown) => {
              log.warn('Failed to save assistant message', {
                projectId,
                error: err instanceof Error ? err.message : String(err)
              })
            })
        }

        // ── Step 5: Update project with result ────────────────────────────────
        await app
          .service('projects')
          .patch(projectId, {
            status: 'ready',
            generationProgress: { percentage: 100, currentStage: 'complete' }
          })
          .catch((err: unknown) => {
            log.warn('Failed to update project status to ready', {
              projectId,
              error: err instanceof Error ? err.message : String(err)
            })
          })

        // ── Step 5.5: Auto-update project title and description ───────────────
        if (result.intent === Intent.GenerateProject) {
          try {
            const titleResponse = await classifierProvider.chat(
              [
                {
                  role: 'user',
                  content: `Based on this project generation request, provide a short project title (max 50 chars) and a one-sentence description (max 150 chars).

User request: "${prompt}"

Respond in this exact JSON format only, no other text:
{"title": "...", "description": "..."}`
                }
              ],
              { temperature: 0.2, maxTokens: 128, timeoutMs: 10000 }
            )

            const parsed = JSON.parse(titleResponse.content.trim())
            if (parsed.title && parsed.description) {
              await app
                .service('projects')
                .patch(projectId, {
                  name: String(parsed.title).slice(0, 100),
                  description: String(parsed.description).slice(0, 500)
                })
              log.info('Project title/description auto-updated', { projectId, title: parsed.title })
            }
          } catch (err: unknown) {
            log.warn('Failed to auto-update project title/description', {
              projectId,
              error: err instanceof Error ? err.message : String(err)
            })
          }
        }

        // ── Step 6: Trigger async incremental re-index ────────────────────────
        indexingQueue
          .add(
            'sync',
            { projectId },
            {
              delay: 2000,
              jobId: `sync-${projectId}`,
              removeOnComplete: true
            }
          )
          .catch((err: unknown) => {
            log.warn('Failed to enqueue indexing job', {
              projectId,
              error: err instanceof Error ? err.message : String(err)
            })
          })

        log.info('Orchestration job completed', { jobId: job.id, projectId, intent: result.intent })
        jobTracker.completeJob(job.id!)
        return result
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err))
        log.error('Orchestration job failed', { jobId: job.id, projectId, error: error.message })

        await jobTracker.cancelJob(job.id!)

        await app
          .service('projects')
          .patch(projectId, {
            status: 'error',
            errorMessage: error.message
          })
          .catch((patchErr: unknown) => {
            log.warn('Failed to update project status to error', {
              projectId,
              error: patchErr instanceof Error ? patchErr.message : String(patchErr)
            })
          })

        throw err
      }
    },
    {
      connection: connection as any,
      concurrency: 3
    }
  )

  orchestrationWorker.on('completed', job => {
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
