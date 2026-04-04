import { createModuleLogger } from '../../logging'
import { classifyIntent } from '../intent/classifier'
import { INTENT_CONFIG } from '../intent/intents'
import { buildPrompt } from '../prompt/builder'
import { retrieveContext } from '../rag/retriever'
import type { ChromaVectorStore } from '../rag/chroma.client'
import type {
  ILLMProvider,
  LLMMessage,
  OrchestrationJobData,
  OrchestrationResult,
} from '../types'

const log = createModuleLogger('orchestrator')

export interface OrchestratorDeps {
  router: ILLMProvider
  classifierProvider: ILLMProvider
  classifierModel?: string
  vectorStore: ChromaVectorStore
  app: { service: (name: string) => any; get: (key: string) => any }
  emit: (event: string, projectId: string, payload: unknown) => void
}

/**
 * Main orchestration pipeline.
 *
 * Steps:
 *   1. Classify intent (fast LLM call)
 *   2. Retrieve RAG context if needed
 *   3. Build token-budgeted prompt
 *   4. Stream response via LLM router
 *   5. Emit Socket.IO events throughout
 */
export async function orchestrate(
  data: OrchestrationJobData,
  deps: OrchestratorDeps
): Promise<OrchestrationResult> {
  const { projectId, userId, prompt, conversationHistory = [] } = data
  const { router, classifierProvider, classifierModel, vectorStore, app, emit } = deps

  log.info('Orchestration started', { projectId, userId, promptLength: prompt.length })
  emit('orchestration:started', projectId, { projectId, userId })

  // 1. Classify intent
  const classified = await classifyIntent(prompt, classifierProvider, classifierModel)
  log.info('Intent classified', { projectId, intent: classified.intent, confidence: classified.confidence })
  emit('orchestration:intent', projectId, { intent: classified.intent, confidence: classified.confidence, entities: classified.entities })

  const intentConfig = INTENT_CONFIG[classified.intent]
  const llmConfig = app.get('llm')
  const contextWindow: number = llmConfig?.contextWindow ?? 131072

  // Budget for RAG: 60% of non-system space (rough estimate before full build)
  const ragBudget = Math.floor(contextWindow * 0.35)

  // 2. Retrieve RAG context if intent needs it
  let retrieved = { chunks: [] as any[], totalTokens: 0 }
  if (intentConfig.needsRAG && projectId) {
    try {
      retrieved = await retrieveContext(projectId, prompt, ragBudget, vectorStore)
      log.debug('RAG context retrieved', { projectId, chunks: retrieved.chunks.length, tokens: retrieved.totalTokens })
      emit('orchestration:context', projectId, { chunksFound: retrieved.chunks.length, tokensUsed: retrieved.totalTokens })
    } catch (err: unknown) {
      log.warn('RAG retrieval failed, continuing without context', {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // 3. Get project metadata for prompt templates
  let projectMeta: { framework?: string; language?: string; name?: string } = {}
  try {
    const project = await app.service('projects').get(projectId)
    projectMeta = {
      framework: project?.framework,
      language: project?.language,
      name: project?.name,
    }
  } catch {
    // Non-fatal — continue without project meta
  }

  // 4. Build prompt
  const built = buildPrompt({
    intent: classified.intent,
    userQuery: prompt,
    retrievedContext: retrieved,
    conversationHistory: conversationHistory as LLMMessage[],
    projectMeta,
    modelContextWindow: contextWindow,
  })

  log.debug('Prompt built', {
    projectId,
    messages: built.messages.length,
    chunksUsed: built.metadata.chunksUsed,
    historyTurns: built.metadata.historyTurns,
    budget: built.budget,
  })

  // 5. Stream response
  let fullContent = ''
  let finalModel = ''
  let finalProvider = ''
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  try {
    for await (const chunk of router.chatStream(built.messages)) {
      if (chunk.content) {
        fullContent += chunk.content
        emit('orchestration:token', projectId, { token: chunk.content })
      }
    }

    // Get usage via non-streaming call metadata is not available on stream
    // We do a best-effort token estimate
    usage = {
      promptTokens: built.budget.systemPrompt + built.budget.retrievedContext + built.budget.history + built.budget.userQuery,
      completionTokens: Math.ceil(fullContent.length / 4),
      totalTokens: 0,
    }
    usage.totalTokens = usage.promptTokens + usage.completionTokens

    // Get model/provider info from router
    finalModel = llmConfig?.groq?.defaultModel ?? 'unknown'
    finalProvider = 'router'
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err))
    log.error('LLM generation failed', { projectId, error: error.message })
    emit('orchestration:error', projectId, { error: error.message })
    throw error
  }

  log.info('Orchestration complete', { projectId, contentLength: fullContent.length, intent: classified.intent })
  emit('orchestration:completed', projectId, {
    intent: classified.intent,
    contentLength: fullContent.length,
    usage,
  })

  return {
    content: fullContent,
    intent: classified.intent,
    model: finalModel,
    provider: finalProvider,
    usage,
  }
}
