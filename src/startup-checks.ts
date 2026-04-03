import { execFileSync, spawn } from 'child_process'
import type { ChildProcess } from 'child_process'

import config from 'config'

import type { Application } from './declarations'
import { logger } from './logger'
import { llmClient, getModelConfig } from './llm/client'
import { chromaClient } from './agent/context/chroma-client'
import { r2Client } from './storage/r2.client'

// ─── ChromaDB process management ──────────────────────────────────────────────

let chromaProcess: ChildProcess | null = null

/** Kill the managed ChromaDB child process if one was spawned. */
export function stopChromaProcess(): void {
  if (chromaProcess && !chromaProcess.killed) {
    logger.info('ChromaDB: stopping managed process (pid %d)...', chromaProcess.pid)
    chromaProcess.kill('SIGTERM')
    chromaProcess = null
  }
}

/**
 * Start ChromaDB if it is not already reachable.
 * Tries `chroma run --port <port>`. Polls up to 20s for readiness.
 * Non-fatal: logs a warning if chroma is not installed or fails to start.
 */
async function startChromaIfNeeded(host: string, port: number): Promise<void> {
  const url = `http://${host}:${port}/api/v1/heartbeat`

  // Already running?
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(2_000) })
    if (resp.ok) {
      logger.info('ChromaDB: already running on port %d', port)
      return
    }
  } catch {
    // Not running yet — need to start
  }

  logger.info('ChromaDB: starting on port %d...', port)
  try {
    chromaProcess = spawn('chroma', ['run', '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    })

    chromaProcess.stdout?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim()
      if (line) logger.debug('ChromaDB: %s', line)
    })
    chromaProcess.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim()
      if (line) logger.debug('ChromaDB: %s', line)
    })
    chromaProcess.on('error', (err: Error) => {
      logger.warn('ChromaDB: process error — %s', err.message)
      chromaProcess = null
    })
    chromaProcess.on('exit', (code) => {
      if (code !== null && code !== 0) {
        logger.warn('ChromaDB: process exited with code %d', code)
      }
      chromaProcess = null
    })
  } catch (err: unknown) {
    logger.warn('ChromaDB: failed to spawn — %s', err instanceof Error ? err.message : String(err))
    return
  }

  // Poll until ready (max 20s)
  for (let i = 0; i < 20; i++) {
    await new Promise<void>(resolve => setTimeout(resolve, 1_000))
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(1_000) })
      if (resp.ok) {
        logger.info('ChromaDB: ready after %ds', i + 1)
        return
      }
    } catch {
      // Still starting
    }
  }
  logger.warn('ChromaDB: did not become ready within 20s — semantic search may be unavailable')
}

// ─── Result types ─────────────────────────────────────────────────────────────

interface CheckResult {
  name: string
  ok: boolean
  detail: string
  critical: boolean
}

// ─── Individual checks ────────────────────────────────────────────────────────

async function checkMongoDB(app: Application): Promise<CheckResult> {
  try {
    const db = await app.get('mongodbClient')
    await db.command({ ping: 1 })
    return { name: 'MongoDB', ok: true, detail: 'ping OK', critical: true }
  } catch (err: unknown) {
    return { name: 'MongoDB', ok: false, detail: err instanceof Error ? err.message : String(err), critical: true }
  }
}

async function checkRedis(): Promise<CheckResult> {
  try {
    const { getRedisClient } = await import('./services/redis/client')
    const redis = await getRedisClient()
    const pong = await redis.ping()
    return { name: 'Redis', ok: pong === 'PONG', detail: 'ping OK', critical: true }
  } catch (err: unknown) {
    return { name: 'Redis', ok: false, detail: err instanceof Error ? err.message : String(err), critical: true }
  }
}

async function checkOllama(): Promise<CheckResult> {
  try {
    const models = await llmClient.listModels()
    const names = models.map(m => m.name)

    // Require the generation model (code gen, critical)
    const generationModel = getModelConfig('generation').name
    const planningModel = getModelConfig('planning').name

    const hasGeneration = names.some(n => n.includes(generationModel.split(':')[0]))
    const hasPlanning = names.some(n => n.includes(planningModel.split(':')[0]))

    const missing: string[] = []
    if (!hasGeneration) missing.push(generationModel)
    if (!hasPlanning) missing.push(planningModel)

    if (missing.length > 0) {
      const available = names.join(', ') || '(none)'
      const pullCmds = missing.map(m => `ollama pull ${m}`).join(', ')
      return {
        name: 'Ollama',
        ok: false,
        detail: `Missing models: ${missing.join(', ')}. Run: ${pullCmds}. Available: ${available}`,
        critical: !hasGeneration  // Only critical if generation model is missing
      }
    }

    // Quick health check — measure response time for each model
    const checks: string[] = []
    for (const modelName of [generationModel, planningModel]) {
      const t0 = Date.now()
      await llmClient.warmModel(modelName)
      checks.push(`${modelName} (${Date.now() - t0}ms)`)
    }

    return {
      name: 'Ollama',
      ok: true,
      detail: `Models ready: ${checks.join(', ')}`,
      critical: true
    }
  } catch (err: unknown) {
    return { name: 'Ollama', ok: false, detail: err instanceof Error ? err.message : String(err), critical: true }
  }
}

async function checkNomicEmbed(chromaAvailable: boolean): Promise<CheckResult> {
  if (!chromaAvailable) {
    return { name: 'nomic-embed-text', ok: true, detail: 'ChromaDB not available — skipping embed model check', critical: false }
  }
  try {
    const models = await llmClient.listModels()
    const found = models.some(m => m.name.includes('nomic-embed-text'))
    return {
      name: 'nomic-embed-text',
      ok: found,
      detail: found ? 'available' : 'not found — run: ollama pull nomic-embed-text',
      critical: false
    }
  } catch {
    return { name: 'nomic-embed-text', ok: false, detail: 'check failed', critical: false }
  }
}

function checkPython3(): CheckResult {
  try {
    const output = execFileSync('python3', ['--version'], { encoding: 'utf8', timeout: 5_000 }).trim()
    return { name: 'Python 3', ok: true, detail: output, critical: true }
  } catch (err: unknown) {
    return { name: 'Python 3', ok: false, detail: err instanceof Error ? err.message : 'not found', critical: true }
  }
}

function checkPyflakes(): CheckResult {
  try {
    execFileSync('python3', ['-m', 'pyflakes', '--version'], { encoding: 'utf8', timeout: 5_000, stdio: 'pipe' })
    return { name: 'pyflakes', ok: true, detail: 'available', critical: false }
  } catch {
    // pyflakes prints its version to stderr on some platforms — try alternate check
    try {
      execFileSync('python3', ['-c', 'import pyflakes; print(pyflakes.__version__)'], { encoding: 'utf8', timeout: 5_000 })
      return { name: 'pyflakes', ok: true, detail: 'available', critical: false }
    } catch (err: unknown) {
      return { name: 'pyflakes', ok: false, detail: 'not installed — run: pip install pyflakes', critical: false }
    }
  }
}

async function checkR2(): Promise<CheckResult> {
  try {
    await r2Client.listObjects('_health_check_probe_nonexistent_/')
    return { name: 'R2 Storage', ok: true, detail: 'listObjects OK', critical: true }
  } catch (err: unknown) {
    return { name: 'R2 Storage', ok: false, detail: err instanceof Error ? err.message : String(err), critical: true }
  }
}

async function checkChromaDB(): Promise<CheckResult> {
  const ok = await chromaClient.ping()
  return {
    name: 'ChromaDB',
    ok,
    detail: ok ? 'heartbeat OK' : 'unavailable (semantic search disabled — start with: chroma run)',
    critical: false
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

/**
 * Run all startup checks. Logs results and throws if any critical check fails.
 * Call from src/index.ts before starting the server.
 */
export async function runStartupChecks(app: Application): Promise<void> {
  logger.info('Running startup checks...')

  // Start ChromaDB if not already running, then check it
  const chromaConfig = config.get<{ host: string; port: number }>('chromadb')
  await startChromaIfNeeded(chromaConfig.host, chromaConfig.port)
  // Reset client so any previous failure latch is cleared after (re)spawn
  chromaClient.reset()

  const chromaResult = await checkChromaDB()

  const results: CheckResult[] = await Promise.all([
    checkMongoDB(app),
    checkRedis(),
    checkOllama(),
    Promise.resolve(checkPython3()),
    Promise.resolve(checkPyflakes()),
    checkR2(),
    Promise.resolve(chromaResult),
    checkNomicEmbed(chromaResult.ok)
  ])

  let allCriticalOk = true

  for (const result of results) {
    const icon = result.ok ? '✓' : result.critical ? '✗' : '⚠'
    const level = result.ok ? 'info' : result.critical ? 'error' : 'warn'
    logger[level]('  %s %s: %s', icon, result.name, result.detail)

    if (!result.ok && result.critical) {
      allCriticalOk = false
    }
  }

  if (!allCriticalOk) {
    const failed = results.filter(r => !r.ok && r.critical).map(r => r.name)
    throw new Error(`Startup checks failed: ${failed.join(', ')}`)
  }

  logger.info('All critical startup checks passed.')
}
