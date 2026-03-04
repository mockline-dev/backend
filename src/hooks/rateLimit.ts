import type { HookContext } from '../declarations';

// In-memory store for rate limiting (resets on server restart)
const requestCounts = new Map<string, { count: number; resetAt: number }>()

/**
 * Rate limiting hook based on authenticated user ID.
 * @param maxRequests - Maximum number of requests allowed in the time window
 * @param windowMs - Time window in milliseconds
 */
export const rateLimit = (maxRequests: number, windowMs: number) => {
  return async (context: HookContext) => {
    const userId = context.params.user?._id?.toString()
    if (!userId) return context // unauthenticated calls handled by authenticate hook

    const now = Date.now()
    const record = requestCounts.get(userId)

    if (record && record.resetAt > now) {
      if (record.count >= maxRequests) {
        const retryAfter = Math.ceil((record.resetAt - now) / 1000)
        const error = new Error(`Rate limit exceeded. Try again in ${retryAfter}s`)
        ;(error as any).code = 429
        throw error
      }
      record.count++
    } else {
      requestCounts.set(userId, { count: 1, resetAt: now + windowMs })
    }

    return context
  }
}
