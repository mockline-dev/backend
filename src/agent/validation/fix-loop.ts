import { getProvider } from '../../llm/providers/registry'
import { logger } from '../../logger'
import { applySearchReplace } from '../../services/ai-service/diff-utils'
import type { ValidationError } from './python-validator'

const MAX_FILE_CHARS = 8_000      // ~2K tokens — keep prompt under 6K total
const MAX_ERRORS_SHOWN = 8
const FIX_TEMPERATURE = 0.05

export interface FixTarget {
  file: { path: string; content: string }
  errors: ValidationError[]
}

export interface FixResult {
  path: string
  content: string
  /** Number of fix attempts made before success (1-3) */
  attempts: number
}

export interface FixLoopResult {
  fixed: FixResult[]
  failed: FixTarget[]
}

/**
 * AI-assisted fix loop.
 *
 * For each failed file:
 *   - Ask the LLM to produce SEARCH/REPLACE blocks targeting the errors.
 *   - Apply the blocks via applySearchReplace.
 *   - Re-validate; if still failing, retry with updated error list (max `maxAttempts`).
 *
 * Runs **sequentially** — never issues parallel LLM calls (single-GPU constraint).
 */
export async function runFixLoop(
  targets: FixTarget[],
  options: {
    /** Validate a single file; returns [] when valid. */
    validate: (path: string, content: string) => Promise<ValidationError[]>
    /** Max LLM attempts per file (default: 3) */
    maxAttempts?: number
  }
): Promise<FixLoopResult> {
  const { validate, maxAttempts = 3 } = options
  const fixed: FixResult[] = []
  const failed: FixTarget[] = []

  for (const target of targets) {
    const result = await fixOneFile(target, validate, maxAttempts)
    if (result) {
      fixed.push(result)
    } else {
      failed.push(target)
    }
  }

  logger.info(
    'FixLoop: %d/%d files fixed, %d still failing',
    fixed.length,
    targets.length,
    failed.length
  )

  return { fixed, failed }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function fixOneFile(
  target: FixTarget,
  validate: (path: string, content: string) => Promise<ValidationError[]>,
  maxAttempts: number
): Promise<FixResult | null> {
  let { content } = target.file
  const { path } = target.file
  let errors = target.errors

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    logger.debug('FixLoop: attempt %d/%d for %s (%d errors)', attempt, maxAttempts, path, errors.length)

    const fixedContent = await callLLM(path, content, errors)
    if (!fixedContent) {
      logger.warn('FixLoop: LLM returned no content for %s on attempt %d', path, attempt)
      continue
    }

    // Re-validate
    const remaining = await validate(path, fixedContent)

    if (remaining.length === 0) {
      logger.info('FixLoop: fixed %s after %d attempt(s)', path, attempt)
      return { path, content: fixedContent, attempts: attempt }
    }

    // Still failing — update content + errors for next attempt
    content = fixedContent
    errors = remaining
    logger.debug(
      'FixLoop: %s still has %d errors after attempt %d',
      path,
      remaining.length,
      attempt
    )
  }

  logger.warn('FixLoop: could not fix %s after %d attempts', path, maxAttempts)
  return null
}

async function callLLM(
  path: string,
  content: string,
  errors: ValidationError[]
): Promise<string | null> {
  const errorBlock = errors
    .slice(0, MAX_ERRORS_SHOWN)
    .map(e => `  Line ${e.line ?? '?'}${e.code ? ` [${e.code}]` : ''}: ${e.message}`)
    .join('\n')

  const truncated = content.length > MAX_FILE_CHARS
    ? content.slice(0, MAX_FILE_CHARS) + '\n# ... (truncated)'
    : content

  const prompt = `You are an expert Python debugger. Fix the errors in the file below.

FILE: ${path}
ERRORS:
${errorBlock}

FILE CONTENT:
${truncated}

OUTPUT FORMAT — return only SEARCH/REPLACE blocks, nothing else:
<<<<<<< SEARCH
<exact lines to replace>
=======
<corrected lines>
>>>>>>> REPLACE

Rules:
- One block per distinct error location.
- The SEARCH text must match the file exactly (same whitespace).
- Fix ONLY what the errors require — do not rewrite unrelated code.
- If an import is missing, add a SEARCH/REPLACE that inserts it after the last existing import.
- Never output the full file — only the change blocks.`

  try {
    const provider = getProvider()
    let raw = ''

    for await (const chunk of provider.chatStream(
      [{ role: 'user', content: prompt }],
      undefined,
      { temperature: FIX_TEMPERATURE, num_predict: 1024 }
    )) {
      raw += chunk.message.content
    }

    if (!raw.includes('<<<<<<< SEARCH')) {
      // LLM returned a full file instead of blocks — accept it as fallback
      const stripped = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
      return stripped || null
    }

    // Apply all SEARCH/REPLACE blocks
    const { newContent, unapplied } = applySearchReplace(content, raw)

    if (unapplied.length > 0) {
      logger.debug(
        'FixLoop: %d/%d blocks could not be applied for %s',
        unapplied.length,
        unapplied.length + (raw.match(/<<<<<<< SEARCH/g)?.length ?? 0) - unapplied.length,
        path
      )
    }

    // If nothing changed, the LLM's blocks didn't match — return null to retry
    return newContent !== content ? newContent : null
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn('FixLoop: LLM call failed for %s: %s', path, msg)
    return null
  }
}
