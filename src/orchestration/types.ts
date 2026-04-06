// ─── LLM Provider ───────────────────────────────────────────────────────────

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMResponse {
  content: string
  model: string
  provider: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  finishReason: string
}

export interface LLMStreamChunk {
  content: string
  done: boolean
}

export interface LLMCallOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  json?: boolean
}

export interface ILLMProvider {
  readonly name: string
  chat(messages: LLMMessage[], opts?: LLMCallOptions): Promise<LLMResponse>
  chatStream(messages: LLMMessage[], opts?: LLMCallOptions): AsyncIterable<LLMStreamChunk>
}

// ─── Intent ─────────────────────────────────────────────────────────────────

export enum Intent {
  GenerateProject = 'generate_project',
  EditCode = 'edit_code',
  ExplainCode = 'explain_code',
  FixBug = 'fix_bug',
  AddFeature = 'add_feature',
  General = 'general'
}

export interface ClassifiedIntent {
  intent: Intent
  confidence: number
  entities: Record<string, string>
}

// ─── RAG ────────────────────────────────────────────────────────────────────

export interface CodeChunk {
  id: string
  filepath: string
  content: string
  startLine: number
  endLine: number
  symbolName?: string
  symbolKind?: 'function' | 'class' | 'method' | 'module' | 'block'
}

export interface RetrievedContext {
  chunks: CodeChunk[]
  totalTokens: number
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

export interface PromptBudget {
  systemPrompt: number
  retrievedContext: number
  history: number
  userQuery: number
  responseReserve: number
  total: number
}

export interface BuiltPrompt {
  messages: LLMMessage[]
  budget: PromptBudget
  metadata: {
    intent: Intent
    chunksUsed: number
    historyTurns: number
  }
}

export interface BuildPromptParams {
  intent: Intent
  userQuery: string
  retrievedContext: RetrievedContext
  conversationHistory: LLMMessage[]
  projectMeta?: { framework?: string; language?: string; name?: string }
  modelContextWindow?: number
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

export interface OrchestrationJobData {
  projectId: string
  userId: string
  prompt: string
  conversationHistory?: LLMMessage[]
  model?: string
  /** ID of the user message that triggered this job */
  messageId?: string
}

export interface OrchestrationResult {
  content: string
  intent: Intent
  model: string
  provider: string
  usage: LLMResponse['usage']
  enhancedPrompt?: string
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class RateLimitError extends Error {
  readonly provider: string
  constructor(provider: string, message?: string) {
    super(message ?? `Rate limited by ${provider}`)
    this.name = 'RateLimitError'
    this.provider = provider
  }
}

export class ProviderTimeoutError extends Error {
  readonly provider: string
  constructor(provider: string, timeoutMs: number) {
    super(`${provider} timed out after ${timeoutMs}ms`)
    this.name = 'ProviderTimeoutError'
    this.provider = provider
  }
}

export class AllProvidersFailedError extends Error {
  readonly errors: Error[]
  constructor(errors: Error[]) {
    super(`All LLM providers failed: ${errors.map(e => e.message).join('; ')}`)
    this.name = 'AllProvidersFailedError'
    this.errors = errors
  }
}
