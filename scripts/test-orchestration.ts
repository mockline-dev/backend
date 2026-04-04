/**
 * End-to-end orchestration smoke test.
 *
 * Tests each layer of the pipeline independently, then runs a full end-to-end call.
 * No Redis, BullMQ, or MongoDB required — runs standalone.
 *
 * Usage:
 *   GROQ_API_KEY=gsk_... npx ts-node --skip-project scripts/test-orchestration.ts
 *
 * Or with keys already in config/default.json:
 *   npx ts-node --skip-project scripts/test-orchestration.ts
 *
 * Optional env vars:
 *   GROQ_API_KEY      — Groq API key
 *   MINIMAX_API_KEY   — MiniMax API key (tested as fallback)
 *   TEST_PROMPT       — Custom prompt to use (default provided)
 *   CHROMA_HOST       — ChromaDB host (default: localhost)
 *   CHROMA_PORT       — ChromaDB port (default: 8000)
 */

import * as path from 'path'

// Load config from config/default.json (same as the app)
const configPath = path.resolve(__dirname, '../config/default.json')
const defaultConfig = JSON.parse(require('fs').readFileSync(configPath, 'utf8'))

const GROQ_API_KEY = process.env.GROQ_API_KEY || defaultConfig.llm?.groq?.apiKey
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || defaultConfig.llm?.minimax?.apiKey
const GROQ_MODEL = defaultConfig.llm?.groq?.defaultModel || 'llama-3.3-70b-versatile'
const CLASSIFIER_MODEL = defaultConfig.llm?.groq?.classifierModel || 'llama-3.1-8b-instant'
const MINIMAX_BASE_URL = defaultConfig.llm?.minimax?.baseUrl || 'https://api.minimaxi.chat/v1'
const MINIMAX_MODEL = defaultConfig.llm?.minimax?.defaultModel || 'MiniMax-Text-01'
const CHROMA_HOST = process.env.CHROMA_HOST || defaultConfig.chromadb?.host || 'localhost'
const CHROMA_PORT = Number(process.env.CHROMA_PORT || defaultConfig.chromadb?.port || 8000)
const TEST_PROMPT = process.env.TEST_PROMPT || 'Create a simple FastAPI todo app with SQLite'

// ─── Imports ──────────────────────────────────────────────────────────────────

import { GroqProvider } from '../src/orchestration/providers/groq.provider'
import { MinimaxProvider } from '../src/orchestration/providers/minimax.provider'
import { LLMRouter } from '../src/orchestration/providers/router'
import { classifyIntent } from '../src/orchestration/intent/classifier'
import { ChromaVectorStore } from '../src/orchestration/rag/chroma.client'
import { retrieveContext } from '../src/orchestration/rag/retriever'
import { buildPrompt } from '../src/orchestration/prompt/builder'
import { countTokens } from '../src/orchestration/prompt/token-counter'
import { chunkText } from '../src/orchestration/chunking/text.chunker'
import { orchestrate } from '../src/orchestration/pipeline/orchestrator'
import { Intent } from '../src/orchestration/types'
import type { OrchestratorDeps } from '../src/orchestration/pipeline/orchestrator'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'

function ok(label: string, detail?: string) {
  console.log(`  ${GREEN}✓${RESET} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`)
}

function fail(label: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  console.log(`  ${RED}✗${RESET} ${label}  ${DIM}${msg}${RESET}`)
}

function warn(label: string, detail?: string) {
  console.log(`  ${YELLOW}⚠${RESET} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`)
}

function section(title: string) {
  console.log(`\n${BOLD}${CYAN}── ${title} ──${RESET}`)
}

function banner(title: string) {
  console.log(`\n${BOLD}${'─'.repeat(55)}${RESET}`)
  console.log(`${BOLD}  ${title}${RESET}`)
  console.log(`${BOLD}${'─'.repeat(55)}${RESET}`)
}

// ─── Test Runners ─────────────────────────────────────────────────────────────

async function testConfig() {
  section('1. Configuration')
  if (GROQ_API_KEY && !GROQ_API_KEY.startsWith('PLACEHOLDER')) {
    ok('GROQ_API_KEY is set', `${GROQ_API_KEY.slice(0, 8)}...`)
  } else {
    fail('GROQ_API_KEY missing or placeholder', 'set GROQ_API_KEY env var or update config/default.json')
  }

  if (MINIMAX_API_KEY && !MINIMAX_API_KEY.startsWith('PLACEHOLDER')) {
    ok('MINIMAX_API_KEY is set', `${MINIMAX_API_KEY.slice(0, 8)}...`)
  } else {
    warn('MINIMAX_API_KEY not set', 'fallback provider unavailable — not blocking')
  }

  ok('Groq model', GROQ_MODEL)
  ok('Classifier model', CLASSIFIER_MODEL)
  ok('Test prompt', `"${TEST_PROMPT.slice(0, 60)}${TEST_PROMPT.length > 60 ? '...' : ''}"`)
}

async function testTokenCounter() {
  section('2. Token Counter')
  try {
    const n = countTokens('Hello, world! This is a test sentence.')
    if (n > 0 && n < 20) {
      ok('countTokens works', `"Hello, world!..." → ${n} tokens`)
    } else {
      fail('countTokens returned unexpected count', `got ${n}`)
    }

    const chunks = chunkText('line one\nline two\nline three\n', 'test.txt')
    ok('text chunker works', `3 lines → ${chunks.length} chunk(s)`)
  } catch (err) {
    fail('Token counter / text chunker error', err)
  }
}

async function testGroqProvider() {
  section('3. Groq Provider')
  if (!GROQ_API_KEY || GROQ_API_KEY.startsWith('PLACEHOLDER')) {
    warn('Skipping — no API key')
    return false
  }

  const provider = new GroqProvider({ apiKey: GROQ_API_KEY, defaultModel: GROQ_MODEL })

  try {
    process.stdout.write(`  Calling ${GROQ_MODEL}... `)
    const response = await provider.chat(
      [{ role: 'user', content: 'Reply with exactly: OK' }],
      { maxTokens: 10, temperature: 0 }
    )
    console.log(`${GREEN}done${RESET}`)
    ok('chat() works', `"${response.content.trim()}"  [${response.usage.totalTokens} tokens]`)
    return true
  } catch (err) {
    console.log(`${RED}failed${RESET}`)
    fail('chat() error', err)
    return false
  }
}

async function testMinimaxProvider() {
  section('4. MiniMax Provider (fallback)')
  if (!MINIMAX_API_KEY || MINIMAX_API_KEY.startsWith('PLACEHOLDER')) {
    warn('Skipping — no API key')
    return false
  }

  const provider = new MinimaxProvider({
    apiKey: MINIMAX_API_KEY,
    baseUrl: MINIMAX_BASE_URL,
    defaultModel: MINIMAX_MODEL,
  })

  try {
    process.stdout.write(`  Calling ${MINIMAX_MODEL}... `)
    const response = await provider.chat(
      [{ role: 'user', content: 'Reply with exactly: OK' }],
      { maxTokens: 10, temperature: 0 }
    )
    console.log(`${GREEN}done${RESET}`)
    ok('chat() works', `"${response.content.trim()}"  [${response.usage.totalTokens} tokens]`)
    return true
  } catch (err) {
    console.log(`${RED}failed${RESET}`)
    fail('chat() error', err)
    return false
  }
}

async function testRouter(groqOk: boolean, minimaxOk: boolean) {
  section('5. LLM Router')
  if (!groqOk) {
    warn('Skipping — Groq provider not available')
    return null
  }

  const primary = new GroqProvider({ apiKey: GROQ_API_KEY, defaultModel: GROQ_MODEL })
  const fallbacks = minimaxOk
    ? [new MinimaxProvider({ apiKey: MINIMAX_API_KEY, baseUrl: MINIMAX_BASE_URL, defaultModel: MINIMAX_MODEL })]
    : []
  const router = new LLMRouter(primary, fallbacks)

  try {
    const response = await router.chat(
      [{ role: 'user', content: 'Reply with exactly: ROUTER_OK' }],
      { maxTokens: 10, temperature: 0 }
    )
    ok('Router routes to primary', `provider=${response.provider}, content="${response.content.trim()}"`)
    return router
  } catch (err) {
    fail('Router error', err)
    return null
  }
}

async function testIntentClassifier(router: LLMRouter | null) {
  section('6. Intent Classifier')
  if (!router) {
    warn('Skipping — router not available')
    return
  }

  const classifierProvider = new GroqProvider({ apiKey: GROQ_API_KEY, defaultModel: CLASSIFIER_MODEL })

  const cases: Array<{ prompt: string; expectedIntent: Intent }> = [
    { prompt: 'Create a FastAPI todo app with authentication', expectedIntent: Intent.GenerateProject },
    { prompt: 'Fix the login endpoint it returns 500', expectedIntent: Intent.FixBug },
    { prompt: 'Explain how the user model works', expectedIntent: Intent.ExplainCode },
  ]

  for (const { prompt, expectedIntent } of cases) {
    try {
      const result = await classifyIntent(prompt, classifierProvider, CLASSIFIER_MODEL)
      const match = result.intent === expectedIntent
      if (match) {
        ok(`"${prompt.slice(0, 40)}"`, `→ ${result.intent} (${(result.confidence * 100).toFixed(0)}% confidence)`)
      } else {
        warn(
          `"${prompt.slice(0, 40)}"`,
          `expected ${expectedIntent}, got ${result.intent} (${(result.confidence * 100).toFixed(0)}%)`
        )
      }
    } catch (err) {
      fail(`classify: "${prompt.slice(0, 40)}"`, err)
    }
  }
}

async function testChromaDB() {
  section('7. ChromaDB Vector Store')
  const store = new ChromaVectorStore(CHROMA_HOST, CHROMA_PORT)

  const alive = await store.ping()
  if (!alive) {
    warn(`ChromaDB not reachable at ${CHROMA_HOST}:${CHROMA_PORT}`, 'RAG will be skipped — pipeline continues without it')
    warn('Start ChromaDB with: docker run -p 8000:8000 chromadb/chroma')
    return store
  }

  ok(`ChromaDB reachable at ${CHROMA_HOST}:${CHROMA_PORT}`)

  // Test upsert + query
  try {
    const testProjectId = '_smoke_test_'
    const chunks = [
      { id: 'test:0', filepath: 'test.py', content: 'def greet(name): return f"Hello {name}"', startLine: 0, endLine: 1 },
      { id: 'test:1', filepath: 'test.py', content: 'def add(a, b): return a + b', startLine: 2, endLine: 3 },
    ]

    await store.addChunks(testProjectId, chunks)
    ok('addChunks() — upserted 2 chunks')

    const results = await store.query(testProjectId, 'greeting function', 5)
    ok('query() works', `found ${results.length} result(s)`)
    if (results.length > 0) {
      ok('top result', `score=${results[0].score.toFixed(3)}, file=${results[0].chunk.filepath}`)
    }

    await store.deleteCollection(testProjectId)
    ok('deleteCollection() — cleaned up')
  } catch (err) {
    fail('ChromaDB operations failed', err)
  }

  return store
}

async function testFullPipeline(router: LLMRouter | null, vectorStore: ChromaVectorStore) {
  section('8. Full Pipeline (end-to-end)')
  if (!router) {
    warn('Skipping — LLM router not available')
    return
  }

  const classifierProvider = new GroqProvider({ apiKey: GROQ_API_KEY, defaultModel: CLASSIFIER_MODEL })

  const events: string[] = []
  const emit = (event: string, _projectId: string, payload: unknown) => {
    events.push(event)
    const p = payload as any
    if (event === 'orchestration:intent') {
      process.stdout.write(`\n  ${DIM}[intent: ${p.intent} @ ${(p.confidence * 100).toFixed(0)}%]${RESET}`)
    } else if (event === 'orchestration:context') {
      process.stdout.write(` ${DIM}[rag: ${p.chunksFound} chunks]${RESET}`)
    } else if (event === 'orchestration:token') {
      process.stdout.write(p.token)
    }
  }

  // Minimal mock app (no DB needed for standalone test)
  const mockApp = {
    service: (_name: string) => ({
      get: async (_id: string) => ({ framework: 'FastAPI', language: 'Python', name: 'test-project' }),
      patch: async () => ({}),
      emit: () => {},
    }),
    get: (key: string) => {
      if (key === 'llm') return defaultConfig.llm
      if (key === 'chromadb') return defaultConfig.chromadb
      return null
    },
  }

  const deps: OrchestratorDeps = {
    router,
    classifierProvider,
    classifierModel: CLASSIFIER_MODEL,
    vectorStore,
    app: mockApp as any,
    emit,
  }

  console.log(`\n  ${DIM}Prompt: "${TEST_PROMPT}"${RESET}`)
  process.stdout.write(`\n  ${CYAN}Response:${RESET} `)

  try {
    const start = Date.now()
    const result = await orchestrate(
      { projectId: 'smoke-test-project', userId: 'smoke-test-user', prompt: TEST_PROMPT },
      deps
    )
    const elapsed = Date.now() - start

    console.log(`\n`)
    ok('Pipeline completed', `${elapsed}ms`)
    ok('Intent detected', result.intent)
    ok('Content length', `${result.content.length} chars`)
    ok('Events fired', events.join(' → '))
    ok('Usage', `prompt=${result.usage.promptTokens} / completion=${result.usage.completionTokens} tokens`)
  } catch (err) {
    console.log()
    fail('Pipeline failed', err)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  banner('Mockline Orchestration Smoke Test')
  console.log(`${DIM}  Tests each layer: config → token counter → providers → intent → ChromaDB → full pipeline${RESET}`)

  await testConfig()
  await testTokenCounter()
  const groqOk = await testGroqProvider()
  const minimaxOk = await testMinimaxProvider()
  const router = await testRouter(groqOk, minimaxOk)
  await testIntentClassifier(router)
  const vectorStore = await testChromaDB()
  await testFullPipeline(router, vectorStore)

  console.log(`\n${BOLD}${'─'.repeat(55)}${RESET}\n`)
}

main().catch((err) => {
  console.error(`\n${RED}Fatal error:${RESET}`, err)
  process.exit(1)
})
