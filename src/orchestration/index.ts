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
export { fetchFileContent } from './rag/file-fetcher'

export { buildPrompt } from './prompt/builder'
export { getSystemPrompt } from './prompt/templates'
export { countTokens, countMessages } from './prompt/token-counter'

export { chunkCode, initTreeSitter, isCodeFile } from './chunking/tree-sitter.chunker'
export { chunkText } from './chunking/text.chunker'

// Merkle tree sync
export { buildTree, diffTrees, updateTree } from './merkle/tree'
export { hashContent, computeRootHash } from './merkle/hash'
export { MerkleTreeStore, createMerkleTreeStore } from './merkle/store'
export { syncProjectIndex } from './merkle/sync'

// Sandbox execution
export { runSandbox, buildFixPrompt } from './sandbox/sandbox'
export { extractCodeBlocks, detectPrimaryLanguage } from './sandbox/code-extractor'
export { OpenSandboxProvider } from './sandbox/providers/opensandbox.provider'

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

export type { MerkleFileNode, MerkleTreeDocument, ChangeSet } from './merkle/types'
export type { SandboxFile, SandboxResult, SandboxOptions } from './sandbox/types'
export type { ISandboxProvider } from './sandbox/providers/provider.interface'
