// Public API for the orchestration layer

export { orchestrate } from './pipeline/orchestrator'
export type { OrchestratorDeps } from './pipeline/orchestrator'

export { createRouter } from './providers/router'
export { GroqProvider } from './providers/groq.provider'
export { MinimaxProvider } from './providers/minimax.provider'
export { LLMRouter } from './providers/router'

export { classifyIntent } from './intent/classifier'
export { Intent, INTENT_CONFIG } from './intent/intents'

export { ChromaVectorStore, getVectorStore } from './rag/chroma.client'
export { retrieveContext } from './rag/retriever'
export { indexProjectFiles } from './rag/indexer'

export { buildPrompt } from './prompt/builder'
export { getSystemPrompt } from './prompt/templates'
export { countTokens, countMessages } from './prompt/token-counter'

export { chunkCode, initTreeSitter, isCodeFile } from './chunking/tree-sitter.chunker'
export { chunkText } from './chunking/text.chunker'

export type {
  ILLMProvider,
  LLMMessage,
  LLMResponse,
  LLMStreamChunk,
  LLMCallOptions,
  Intent as IntentType,
  ClassifiedIntent,
  CodeChunk,
  RetrievedContext,
  BuiltPrompt,
  OrchestrationJobData,
  OrchestrationResult,
  RateLimitError,
  ProviderTimeoutError,
  AllProvidersFailedError,
} from './types'
