import { describe, it, expect, vi, beforeEach } from 'vitest'
import { orchestrate } from '../orchestrator'
import { Intent } from '../../types'
import type { ILLMProvider, LLMResponse, OrchestrationJobData, CodeChunk } from '../../types'
import type { OrchestratorDeps } from '../orchestrator'
import type { ChromaVectorStore } from '../../rag/chroma.client'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProvider(content = 'generated response'): ILLMProvider {
  return {
    name: 'mock-router',
    chat: vi.fn().mockResolvedValue({
      content,
      model: 'test-model',
      provider: 'mock',
      usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
      finishReason: 'stop'
    } satisfies LLMResponse),
    chatStream: vi.fn().mockImplementation(async function* () {
      yield { content: 'generated ', done: false }
      yield { content: 'response', done: true }
    })
  }
}

function makeClassifierProvider(intent: Intent = Intent.General): ILLMProvider {
  return {
    name: 'mock-classifier',
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({ intent, confidence: 0.9, entities: {} }),
      model: 'classifier-model',
      provider: 'mock',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      finishReason: 'stop'
    }),
    chatStream: vi.fn()
  }
}

function makeVectorStore(chunks: CodeChunk[] = []): ChromaVectorStore {
  return {
    ping: vi.fn().mockResolvedValue(true),
    addChunks: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue(chunks.map(c => ({ chunk: c, score: 0.9 }))),
    deleteCollection: vi.fn().mockResolvedValue(undefined)
  } as unknown as ChromaVectorStore
}

function makeApp(projectMeta = {}): any {
  return {
    service: vi.fn().mockReturnValue({
      get: vi
        .fn()
        .mockResolvedValue({ framework: 'FastAPI', language: 'Python', name: 'test', ...projectMeta }),
      patch: vi.fn().mockResolvedValue({}),
      emit: vi.fn()
    }),
    get: vi.fn().mockReturnValue({
      groq: {
        apiKey: 'test',
        defaultModel: 'llama-3.3-70b-versatile',
        classifierModel: 'llama-3.1-8b-instant'
      },
      minimax: { apiKey: 'test', baseUrl: 'https://api.minimaxi.chat/v1', defaultModel: 'MiniMax-Text-01' },
      contextWindow: 8192,
      maxResponseTokens: 2048,
      timeout: 60000
    })
  }
}

const JOB: OrchestrationJobData = {
  projectId: 'proj-123',
  userId: 'user-456',
  prompt: 'Explain the user authentication module',
  conversationHistory: []
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('orchestrate', () => {
  it('returns a result with content and intent', async () => {
    const deps: OrchestratorDeps = {
      router: makeProvider(),
      classifierProvider: makeClassifierProvider(Intent.ExplainCode),
      vectorStore: makeVectorStore(),
      app: makeApp(),
      emit: vi.fn()
    }
    const result = await orchestrate(JOB, deps)
    expect(result.content).toBe('generated response')
    expect(result.intent).toBe(Intent.ExplainCode)
  })

  it('emits orchestration:started event', async () => {
    const emit = vi.fn()
    const deps: OrchestratorDeps = {
      router: makeProvider(),
      classifierProvider: makeClassifierProvider(),
      vectorStore: makeVectorStore(),
      app: makeApp(),
      emit
    }
    await orchestrate(JOB, deps)
    expect(emit).toHaveBeenCalledWith('orchestration:started', JOB.projectId, expect.any(Object))
  })

  it('emits orchestration:intent event', async () => {
    const emit = vi.fn()
    const deps: OrchestratorDeps = {
      router: makeProvider(),
      classifierProvider: makeClassifierProvider(Intent.FixBug),
      vectorStore: makeVectorStore(),
      app: makeApp(),
      emit
    }
    await orchestrate(JOB, deps)
    expect(emit).toHaveBeenCalledWith(
      'orchestration:intent',
      JOB.projectId,
      expect.objectContaining({ intent: Intent.FixBug })
    )
  })

  it('emits orchestration:completed event', async () => {
    const emit = vi.fn()
    const deps: OrchestratorDeps = {
      router: makeProvider(),
      classifierProvider: makeClassifierProvider(),
      vectorStore: makeVectorStore(),
      app: makeApp(),
      emit
    }
    await orchestrate(JOB, deps)
    expect(emit).toHaveBeenCalledWith('orchestration:completed', JOB.projectId, expect.any(Object))
  })

  it('emits orchestration:token events during streaming', async () => {
    const emit = vi.fn()
    const deps: OrchestratorDeps = {
      router: makeProvider(),
      classifierProvider: makeClassifierProvider(),
      vectorStore: makeVectorStore(),
      app: makeApp(),
      emit
    }
    await orchestrate(JOB, deps)
    const tokenEvents = emit.mock.calls.filter(([event]) => event === 'orchestration:token')
    expect(tokenEvents.length).toBeGreaterThan(0)
  })

  it('emits orchestration:error and rethrows on LLM failure', async () => {
    const emit = vi.fn()
    const failingRouter: ILLMProvider = {
      name: 'failing',
      chat: vi.fn(),
      chatStream: vi.fn().mockImplementation(async function* () {
        throw new Error('LLM unavailable')
      })
    }
    const deps: OrchestratorDeps = {
      router: failingRouter,
      classifierProvider: makeClassifierProvider(),
      vectorStore: makeVectorStore(),
      app: makeApp(),
      emit
    }
    await expect(orchestrate(JOB, deps)).rejects.toThrow('LLM unavailable')
    expect(emit).toHaveBeenCalledWith('orchestration:error', JOB.projectId, expect.any(Object))
  })

  it('queries ChromaDB for RAG-requiring intents', async () => {
    const vectorStore = makeVectorStore()
    const deps: OrchestratorDeps = {
      router: makeProvider(),
      classifierProvider: makeClassifierProvider(Intent.EditCode), // needsRAG = true
      vectorStore,
      app: makeApp(),
      emit: vi.fn()
    }
    await orchestrate(JOB, deps)
    expect(vectorStore.query).toHaveBeenCalledWith(JOB.projectId, JOB.prompt, expect.any(Number))
  })

  it('skips ChromaDB for non-RAG intents', async () => {
    const vectorStore = makeVectorStore()
    const deps: OrchestratorDeps = {
      router: makeProvider(),
      classifierProvider: makeClassifierProvider(Intent.GenerateProject), // needsRAG = false
      vectorStore,
      app: makeApp(),
      emit: vi.fn()
    }
    await orchestrate(JOB, deps)
    expect(vectorStore.query).not.toHaveBeenCalled()
  })

  it('continues gracefully when project metadata fetch fails', async () => {
    const app = makeApp()
    app.service.mockReturnValue({
      get: vi.fn().mockRejectedValue(new Error('project not found')),
      patch: vi.fn().mockResolvedValue({}),
      emit: vi.fn()
    })
    const deps: OrchestratorDeps = {
      router: makeProvider('fallback content'),
      classifierProvider: makeClassifierProvider(),
      vectorStore: makeVectorStore(),
      app,
      emit: vi.fn()
    }
    const result = await orchestrate(JOB, deps)
    expect(result.content).toBe('generated response')
  })

  it('returns usage statistics', async () => {
    const deps: OrchestratorDeps = {
      router: makeProvider(),
      classifierProvider: makeClassifierProvider(),
      vectorStore: makeVectorStore(),
      app: makeApp(),
      emit: vi.fn()
    }
    const result = await orchestrate(JOB, deps)
    expect(result.usage.promptTokens).toBeGreaterThanOrEqual(0)
    expect(result.usage.completionTokens).toBeGreaterThanOrEqual(0)
    expect(result.usage.totalTokens).toBeGreaterThanOrEqual(0)
  })
})
