import { logger } from '../logger'
import { stripThinkTags } from './structured-output'
import type { ILLMProvider } from './providers/base'

// ─── Error type ───────────────────────────────────────────────────────────────

export type SafeGenerateFailureReason = 'empty' | 'timeout' | 'error'

export class SafeGenerateError extends Error {
  readonly reason: SafeGenerateFailureReason

  constructor(message: string, reason: SafeGenerateFailureReason) {
    super(message)
    this.name = 'SafeGenerateError'
    this.reason = reason
  }
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface SafeGenerateOptions {
  temperature?: number
  num_predict?: number
  num_ctx?: number
  top_p?: number
  /** Max time to wait for the full response (ms). Default: 60000 */
  timeoutMs?: number
  /** Minimum valid response length after processing (chars). Default: 10 */
  minLength?: number
  /** Human-readable description of this call for logging. Default: 'generate' */
  purpose?: string
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout])
}

function stripMarkdownFences(text: string): string {
  // Strip ```python ... ``` or ``` ... ``` wrappers
  const fenced = text.match(/^```(?:\w+)?\s*\n?([\s\S]*?)```\s*$/m)
  if (fenced) return fenced[1].trim()
  return text
}

function isEffectivelyEmpty(text: string, minLength: number): boolean {
  if (!text || text.trim().length === 0) return true
  if (text.trim() === '{}' || text.trim() === '[]' || text.trim() === 'null') return true
  if (text.trim().length < minLength) return true
  // Only comments — e.g. "# nothing" with no actual code
  const nonCommentLines = text
    .split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('//'))
  if (nonCommentLines.length === 0) return true
  return false
}

// ─── Core wrapper ─────────────────────────────────────────────────────────────

/**
 * Wraps ILLMProvider.generate() with:
 *   - Configurable timeout (default 60s)
 *   - Empty / degenerate response detection
 *   - Think-tag stripping (handles qwen3 /think output)
 *   - Markdown code-fence stripping
 *   - Structured logging (model call duration, response length)
 *
 * Throws SafeGenerateError if the response is empty, times out, or the call fails.
 * There is NO retry loop — one attempt per call. Callers must handle the error.
 */
export async function safeGenerate(
  provider: ILLMProvider,
  systemPrompt: string,
  userPrompt: string,
  options: SafeGenerateOptions = {}
): Promise<string> {
  const {
    timeoutMs = 60_000,
    minLength = 10,
    purpose = 'generate',
    temperature,
    num_predict,
    num_ctx,
    top_p
  } = options

  const promptLength = systemPrompt.length + userPrompt.length
  const startMs = Date.now()

  logger.debug('safeGenerate [%s]: start — prompt length=%d', purpose, promptLength)

  let raw: string
  try {
    raw = await withTimeout(
      provider.generate(systemPrompt, userPrompt, { temperature, num_predict, num_ctx, top_p }),
      timeoutMs,
      `safeGenerate [${purpose}]`
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const elapsed = Date.now() - startMs
    const reason: SafeGenerateFailureReason = msg.includes('timed out') ? 'timeout' : 'error'
    logger.warn('safeGenerate [%s]: %s after %dms — %s', purpose, reason, elapsed, msg)
    throw new SafeGenerateError(msg, reason)
  }

  const elapsed = Date.now() - startMs

  // ── Strip think tags ───────────────────────────────────────────────────────
  let processed = stripThinkTags(raw)

  // ── Strip markdown fences ──────────────────────────────────────────────────
  if (processed) {
    processed = stripMarkdownFences(processed)
  }

  // ── Empty check ───────────────────────────────────────────────────────────
  if (isEffectivelyEmpty(processed, minLength)) {
    logger.warn(
      'safeGenerate [%s]: empty response after processing (raw=%d chars) in %dms — prompt: %s…',
      purpose,
      raw.length,
      elapsed,
      userPrompt.slice(0, 200)
    )
    throw new SafeGenerateError(
      `Empty response from LLM for "${purpose}" (raw length: ${raw.length})`,
      'empty'
    )
  }

  logger.debug(
    'safeGenerate [%s]: success — response=%d chars in %dms',
    purpose,
    processed.length,
    elapsed
  )

  return processed
}
