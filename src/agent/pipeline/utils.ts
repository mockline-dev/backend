import { logger } from '../../logger'

/**
 * Parses JSON from LLM response text, handling markdown code fences.
 * Throws with a descriptive error if parsing fails.
 */
export function parseJson(text: string, context: string): any {
  const match = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  try {
    return JSON.parse((match?.[1] || text).trim())
  } catch (err) {
    logger.error('parseJson: failed to parse %s JSON: %s', context, text.slice(0, 300))
    throw new Error(
      `parseJson: failed to parse ${context}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/**
 * Retries an async function with progressive delays on failure.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  delays: number[],
  label: string
): Promise<T> {
  let lastErr: any
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastErr = err
      if (attempt <= maxRetries) {
        const delay = delays[attempt - 1] ?? 1000
        logger.warn('%s: attempt %d/%d failed, retrying in %dms: %s', label, attempt, maxRetries + 1, delay, err.message)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  throw lastErr
}
