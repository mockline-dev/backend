import { getModelConfig } from '../../llm/client'
import { getProvider } from '../../llm/providers/registry'
import { logger } from '../../logger'
import { applySearchReplace } from '../../services/ai-service/diff-utils'
import type { ValidationError } from './python-validator'

const MAX_FILE_CHARS = 12_000     // ~3K tokens — keep prompt under 6K total with system prompt
const MAX_ERRORS_SHOWN = 8

const FIX_SYSTEM_PROMPT = `You are an expert Python debugger. Your task is to fix errors in Python files.

Output Format Rules:
- Return ONLY SEARCH/REPLACE blocks in this exact format:
<<<<<<< SEARCH
<exact lines from the file, matching whitespace exactly>
=======
<corrected lines>
>>>>>>> REPLACE
- One block per distinct error location
- The SEARCH text MUST match the file exactly (same indentation, same whitespace)
- Fix ONLY what the errors require — do not rewrite unrelated code
- If an import is missing, insert it after the last existing import
- NEVER output the full file — only the change blocks`

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

/**
 * Last-resort fix: ask the LLM to output the entire corrected file.
 * Called when the SEARCH/REPLACE fix loop exhausted all attempts.
 */
export async function runLastResortFix(
  targets: FixTarget[],
  validate: (path: string, content: string) => Promise<ValidationError[]>
): Promise<FixResult[]> {
  const fixed: FixResult[] = []
  const modelCfg = getModelConfig('fixing')
  const provider = getProvider()

  for (const target of targets) {
    const { path, content } = target.file
    const errorBlock = target.errors
      .slice(0, MAX_ERRORS_SHOWN)
      .map(e => `  Line ${e.line ?? '?'}${e.code ? ` [${e.code}]` : ''}: ${e.message}`)
      .join('\n')

    const truncated = content.length > MAX_FILE_CHARS
      ? content.slice(0, MAX_FILE_CHARS) + '\n# ... (truncated)'
      : content

    logger.info('FixLoop: last-resort full-file rewrite for %s (%d errors)', path, target.errors.length)

    try {
      let raw = ''
      for await (const chunk of provider.chatStream(
        [
          {
            role: 'system',
            content: 'You are an expert Python developer. Output ONLY the complete corrected Python file — no explanations, no markdown fences, just the raw Python code.'
          },
          {
            role: 'user',
            content: `Fix ALL the following errors in this Python file and return the complete corrected file.\n\nFILE: ${path}\n\nERRORS:\n${errorBlock}\n\nFILE CONTENT:\n${truncated}`
          }
        ],
        undefined,
        { temperature: modelCfg.temperature, num_predict: 4096 }
      )) {
        raw += chunk.message.content
      }

      const newContent = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
      if (!newContent) {
        logger.warn('FixLoop: last-resort LLM returned empty for %s', path)
        continue
      }

      const remaining = await validate(path, newContent)
      if (remaining.length === 0) {
        logger.info('FixLoop: last-resort fixed %s', path)
        fixed.push({ path, content: newContent, attempts: 1 })
      } else {
        logger.warn('FixLoop: last-resort could not fix %s (%d errors remain)', path, remaining.length)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('FixLoop: last-resort LLM call failed for %s: %s', path, msg)
    }
  }

  return fixed
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
  let useFullFile = false

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    logger.debug('FixLoop: attempt %d/%d for %s (%d errors, mode=%s)', attempt, maxAttempts, path, errors.length, useFullFile ? 'full-file' : 'search-replace')

    const fixedContent = useFullFile
      ? await callLLMFullFile(path, content, errors)
      : await callLLM(path, content, errors)

    if (!fixedContent) {
      logger.warn('FixLoop: LLM returned no content for %s on attempt %d', path, attempt)
      if (!useFullFile) {
        logger.debug('FixLoop: switching to full-file rewrite mode for %s', path)
        useFullFile = true
      }
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

async function callLLMFullFile(
  path: string,
  content: string,
  errors: ValidationError[]
): Promise<string | null> {
  const modelCfg = getModelConfig('fixing')
  const provider = getProvider()

  const errorBlock = errors
    .slice(0, MAX_ERRORS_SHOWN)
    .map(e => `  Line ${e.line ?? '?'}${e.code ? ` [${e.code}]` : ''}: ${e.message}`)
    .join('\n')

  const truncated = content.length > MAX_FILE_CHARS
    ? content.slice(0, MAX_FILE_CHARS) + '\n# ... (truncated)'
    : content

  try {
    let raw = ''
    for await (const chunk of provider.chatStream(
      [
        {
          role: 'system',
          content: 'You are an expert Python developer. Output ONLY the complete corrected Python file — no explanations, no markdown fences, just the raw Python code.'
        },
        {
          role: 'user',
          content: `Fix ALL the following errors in this Python file and return the complete corrected file.\n\nFILE: ${path}\n\nERRORS:\n${errorBlock}\n\nFILE CONTENT:\n${truncated}`
        }
      ],
      undefined,
      { temperature: modelCfg.temperature, num_predict: 4096 }
    )) {
      raw += chunk.message.content
    }

    const newContent = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
    return newContent || null
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn('FixLoop: full-file LLM call failed for %s: %s', path, msg)
    return null
  }
}

async function callLLM(
  path: string,
  content: string,
  errors: ValidationError[]
): Promise<string | null> {
  const modelCfg = getModelConfig('fixing')

  const errorBlock = errors
    .slice(0, MAX_ERRORS_SHOWN)
    .map(e => `  Line ${e.line ?? '?'}${e.code ? ` [${e.code}]` : ''}: ${e.message}`)
    .join('\n')

  const truncated = content.length > MAX_FILE_CHARS
    ? content.slice(0, MAX_FILE_CHARS) + '\n# ... (truncated)'
    : content

  const userPrompt = `FILE: ${path}

ERRORS TO FIX:
${errorBlock}

FILE CONTENT:
\`\`\`python
${truncated}
\`\`\``

  try {
    const provider = getProvider()
    let raw = ''

    for await (const chunk of provider.chatStream(
      [
        { role: 'system', content: FIX_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      undefined,
      { temperature: modelCfg.temperature, num_predict: 4096 }
    )) {
      raw += chunk.message.content
    }

    const totalBlocks = raw.match(/<<<<<<< SEARCH/g)?.length ?? 0

    if (!raw.includes('<<<<<<< SEARCH')) {
      // LLM returned a full file instead of blocks — accept it as fallback
      const stripped = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
      logger.debug('FixLoop: no SEARCH/REPLACE blocks in response for %s — using full-file fallback', path)
      return stripped || null
    }

    // Apply all SEARCH/REPLACE blocks
    const { newContent, unapplied } = applySearchReplace(content, raw)

    if (unapplied.length > 0) {
      logger.debug(
        'FixLoop: %d/%d blocks could not be applied for %s',
        unapplied.length,
        totalBlocks,
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
