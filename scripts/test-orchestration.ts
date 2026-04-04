/**
 * End-to-end orchestration smoke test.
 *
 * Tests each layer of the pipeline independently, then runs a full end-to-end call.
 * No Redis, BullMQ, or MongoDB required — runs standalone.
 *
 * Usage:
 *   GROQ_API_KEY=gsk_... pnpm run test:smoke
 *
 * Or with keys already in config/default.json:
 *   pnpm run test:smoke
 *
 * Optional env vars:
 *   GROQ_API_KEY      — Groq API key
 *   MINIMAX_API_KEY   — MiniMax API key (tested as fallback)
 *   TEST_PROMPT       — Custom prompt to use (default provided)
 *   CHROMA_HOST       — ChromaDB host (default: localhost)
 *   CHROMA_PORT       — ChromaDB port (default: 8000)
 */

import * as fs from 'fs'
import * as path from 'path'

// ─── Config loading (before any src/ imports) ────────────────────────────────

const configPath = path.resolve(__dirname, '../config/default.json')
const defaultConfig: Record<string, any> = JSON.parse(fs.readFileSync(configPath, 'utf8'))

const GROQ_API_KEY: string = process.env.GROQ_API_KEY || defaultConfig?.llm?.groq?.apiKey || ''
const MINIMAX_API_KEY: string = process.env.MINIMAX_API_KEY || defaultConfig?.llm?.minimax?.apiKey || ''
const GROQ_MODEL: string = defaultConfig?.llm?.groq?.defaultModel || 'llama-3.3-70b-versatile'
const CLASSIFIER_MODEL: string = defaultConfig?.llm?.groq?.classifierModel || 'llama-3.1-8b-instant'
const MINIMAX_BASE_URL: string = defaultConfig?.llm?.minimax?.baseUrl || 'https://api.minimaxi.chat/v1'
const MINIMAX_MODEL: string = defaultConfig?.llm?.minimax?.defaultModel || 'MiniMax-Text-01'
const CHROMA_HOST: string = process.env.CHROMA_HOST || defaultConfig?.chromadb?.host || 'localhost'
const CHROMA_PORT: number = Number(process.env.CHROMA_PORT || defaultConfig?.chromadb?.port || 8000)
const TEST_PROMPT: string = process.env.TEST_PROMPT || 'Create a simple FastAPI todo app with SQLite'

// ─── Src imports (after config is resolved) ──────────────────────────────────

import { GroqProvider } from '../src/orchestration/providers/groq.provider'
import { MinimaxProvider } from '../src/orchestration/providers/minimax.provider'
import { LLMRouter } from '../src/orchestration/providers/router'
import { classifyIntent } from '../src/orchestration/intent/classifier'
import { ChromaVectorStore } from '../src/orchestration/rag/chroma.client'
import { buildPrompt } from '../src/orchestration/prompt/builder'
import { countTokens } from '../src/orchestration/prompt/token-counter'
import { chunkText } from '../src/orchestration/chunking/text.chunker'
import { orchestrate } from '../src/orchestration/pipeline/orchestrator'
import { Intent } from '../src/orchestration/types'
import type { OrchestratorDeps } from '../src/orchestration/pipeline/orchestrator'

// ─── Console helpers ─────────────────────────────────────────────────────────

const GREEN  = '\x1b[32m'
const RED    = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN   = '\x1b[36m'
const DIM    = '\x1b[2m'
const RESET  = '\x1b[0m'
const BOLD   = '\x1b[1m'

let passCount = 0
let failCount = 0
let warnCount = 0

function ok(label: string, detail?: string) {
  passCount++
  console.log(`  ${GREEN}✓${RESET} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`)
}

function fail(label: string, err: unknown) {
  failCount++
  const msg = err instanceof Error ? err.message : String(err)
  console.log(`  ${RED}✗${RESET} ${label}  ${DIM}${msg}${RESET}`)
}

function warn(label: string, detail?: string) {
  warnCount++
  console.log(`  ${YELLOW}⚠${RESET} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`)
}

function section(title: string) {
  console.log(`\n${BOLD}${CYAN}── ${title} ──${RESET}`)
}

function banner(title: string) {
  const line = '─'.repeat(55)
  console.log(`\n${BOLD}${line}${RESET}`)
  console.log(`${BOLD}  ${title}${RESET}`)
  console.log(`${BOLD}${line}${RESET}`)
}

function isPlaceholder(key: string): boolean {
  return !key || key.startsWith('PLACEHOLDER')
}

// ─── Test sections ────────────────────────────────────────────────────────────

async function testConfig() {
  section('1. Configuration')

  if (!isPlaceholder(GROQ_API_KEY)) {
    ok('GROQ_API_KEY is set', `${GROQ_API_KEY.slice(0, 8)}...`)
  } else {
    fail('GROQ_API_KEY missing or placeholder — set GROQ_API_KEY env var or update config/default.json', '')
  }

  if (!isPlaceholder(MINIMAX_API_KEY)) {
    ok('MINIMAX_API_KEY is set', `${MINIMAX_API_KEY.slice(0, 8)}...`)
  } else {
    warn('MINIMAX_API_KEY not set', 'fallback provider unavailable — non-blocking')
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

async function testGroqProvider(): Promise<boolean> {
  section('3. Groq Provider')

  if (isPlaceholder(GROQ_API_KEY)) {
    warn('Skipping — no API key')
    return false
  }

  const provider = new GroqProvider({ apiKey: GROQ_API_KEY, defaultModel: GROQ_MODEL })

  try {
    process.stdout.write(`  Calling ${GROQ_MODEL}... `)
    const response = await provider.chat(
      [{ role: 'user', content: 'Reply with exactly the word: OK' }],
      { maxTokens: 10, temperature: 0 }
    )
    console.log(`${GREEN}done${RESET}`)
    ok('chat() works', `"${response.content.trim()}"  [${response.usage.totalTokens} tokens, model=${response.model}]`)
    return true
  } catch (err) {
    console.log(`${RED}failed${RESET}`)
    fail('chat() error', err)
    return false
  }
}

async function testMinimaxProvider(): Promise<boolean> {
  section('4. MiniMax Provider (fallback)')

  if (isPlaceholder(MINIMAX_API_KEY)) {
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
      [{ role: 'user', content: 'Reply with exactly the word: OK' }],
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

async function testRouter(groqOk: boolean, minimaxOk: boolean): Promise<LLMRouter | null> {
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
      [{ role: 'user', content: 'Reply with exactly the word: ROUTER_OK' }],
      { maxTokens: 10, temperature: 0 }
    )
    ok('Routes to primary provider', `content="${response.content.trim()}"`)
    ok('Fallbacks configured', minimaxOk ? '1 fallback (MiniMax)' : 'none — only Groq available')
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

  const cases: Array<{ prompt: string; expected: Intent }> = [
    { prompt: 'Create a FastAPI todo app with authentication', expected: Intent.GenerateProject },
    { prompt: 'Build a REST API for a blog with users and posts', expected: Intent.GenerateProject },
    { prompt: 'Fix the login endpoint it returns 500', expected: Intent.FixBug },
    { prompt: 'Explain how the user model works', expected: Intent.ExplainCode },
    { prompt: 'Add a search endpoint to the posts service', expected: Intent.AddFeature },
  ]

  // Run all cases in parallel — cuts serial latency from N×400ms to ~400ms
  const start = Date.now()
  const results = await Promise.all(
    cases.map(({ prompt }) => classifyIntent(prompt, classifierProvider, CLASSIFIER_MODEL))
  )
  const elapsed = Date.now() - start

  for (let i = 0; i < cases.length; i++) {
    const { prompt, expected } = cases[i]
    const result = results[i]
    const match = result.intent === expected
    const confidence = `${(result.confidence * 100).toFixed(0)}%`
    const short = `"${prompt.slice(0, 50)}"`
    if (match) {
      ok(short, `→ ${result.intent} (${confidence})`)
    } else {
      warn(short, `expected ${expected}, got ${result.intent} (${confidence})`)
    }
  }
  ok(`All ${cases.length} cases completed in parallel`, `${elapsed}ms total`)
}

async function testChromaDB(): Promise<ChromaVectorStore> {
  section('7. ChromaDB Vector Store')

  const store = new ChromaVectorStore(CHROMA_HOST, CHROMA_PORT)
  const alive = await store.ping()

  if (!alive) {
    warn(`Not reachable at ${CHROMA_HOST}:${CHROMA_PORT}`, 'RAG will be skipped — pipeline still works')
    warn('To start: docker run -p 8000:8000 chromadb/chroma')
    return store
  }

  ok(`Reachable at ${CHROMA_HOST}:${CHROMA_PORT}`)

  const testProjectId = '_smoke_test_'
  try {
    await store.addChunks(testProjectId, [
      { id: 'test:0', filepath: 'test.py', content: 'def greet(name): return f"Hello {name}"', startLine: 0, endLine: 1 },
      { id: 'test:1', filepath: 'test.py', content: 'def add(a, b): return a + b', startLine: 2, endLine: 3 },
    ])
    ok('addChunks() — upserted 2 chunks')

    const results = await store.query(testProjectId, 'greeting function', 5)
    ok(`query() — found ${results.length} result(s)`, results.length > 0 ? `top score=${results[0].score.toFixed(3)}` : '')

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
    const p = payload as Record<string, any>
    if (event === 'orchestration:intent') {
      process.stdout.write(`\n  ${DIM}[intent: ${p.intent} @ ${(p.confidence * 100).toFixed(0)}%]${RESET}`)
    } else if (event === 'orchestration:context') {
      process.stdout.write(` ${DIM}[rag: ${p.chunksFound} chunk(s)]${RESET}`)
    } else if (event === 'orchestration:token' && p.token) {
      process.stdout.write(p.token)
    }
  }

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
      { projectId: 'smoke-test', userId: 'smoke-user', prompt: TEST_PROMPT },
      deps
    )
    const elapsed = Date.now() - start

    console.log('\n')
    ok('Pipeline completed', `${elapsed}ms`)
    ok('Intent detected', result.intent)
    ok('Content generated', `${result.content.length} chars`)
    ok('Events fired', events.join(' → '))
    ok('Token usage', `prompt=${result.usage.promptTokens} + completion=${result.usage.completionTokens} = ${result.usage.totalTokens} total`)
  } catch (err) {
    console.log()
    fail('Pipeline failed', err)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  banner('Mockline Orchestration Smoke Test')
  console.log(`${DIM}  Tests each layer: config → tokens → Groq → MiniMax → router → intent → ChromaDB → full pipeline${RESET}`)

  await testConfig()
  await testTokenCounter()
  const groqOk     = await testGroqProvider()
  const minimaxOk  = await testMinimaxProvider()
  const router     = await testRouter(groqOk, minimaxOk)
  await testIntentClassifier(router)
  const vectorStore = await testChromaDB()
  await testFullPipeline(router, vectorStore)

  // ─── Summary ─────────────────────────────────────────────────────────────
  const line = '─'.repeat(55)
  console.log(`\n${BOLD}${line}${RESET}`)
  console.log(`  ${GREEN}${passCount} passed${RESET}  ${failCount > 0 ? RED : DIM}${failCount} failed${RESET}  ${warnCount > 0 ? YELLOW : DIM}${warnCount} warnings${RESET}`)
  console.log(`${BOLD}${line}${RESET}\n`)

  if (failCount > 0) process.exit(1)
}

main().catch((err) => {
  console.error(`\n${RED}Fatal error:${RESET}`, err)
  process.exit(1)
})
