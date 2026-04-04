import { logger } from '../../logger'

// ─── User-facing error types ──────────────────────────────────────────────────

export type ErrorCategory = 'prompt_error' | 'ai_error' | 'storage_error' | 'internal_error'

export interface UserError {
  message: string
  category: ErrorCategory
}

// ─── Error pattern matchers ───────────────────────────────────────────────────

const AI_CONNECTION_PATTERNS = [
  /ECONNREFUSED/i,
  /EHOSTUNREACH/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /connect ECONNRESET/i,
  /fetch failed/i,
  /network.*error/i,
]

const MODEL_NOT_FOUND_PATTERNS = [
  /model.*not found/i,
  /pull model manifest/i,
  /no such model/i,
  /model.*does not exist/i,
]

const R2_PATTERNS = [
  /NoSuchBucket/i,
  /InvalidAccessKeyId/i,
  /SignatureDoesNotMatch/i,
  /R2.*error/i,
  /S3.*error/i,
  /putObject/i,
  /getObject/i,
  /listObjects/i,
]

const PROMPT_PATTERNS = [
  /PlanningError/i,
  /empty.*entities/i,
  /no entities/i,
  /invalid.*plan/i,
  /prompt.*too short/i,
  /describe.*project/i,
]

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Classifies an unknown error into a user-friendly message and category.
 * Never exposes stack traces, internal variable names, or raw error messages.
 */
export function classifyError(err: unknown): UserError {
  const raw = err instanceof Error ? err.message : String(err)

  // Log the full raw error for debugging
  logger.debug('classifyError: raw=%s', raw)

  if (MODEL_NOT_FOUND_PATTERNS.some(p => p.test(raw))) {
    return {
      message: 'AI model configuration error. Please contact support.',
      category: 'ai_error'
    }
  }

  if (AI_CONNECTION_PATTERNS.some(p => p.test(raw))) {
    return {
      message: 'AI service is temporarily unavailable. Please try again later.',
      category: 'ai_error'
    }
  }

  if (R2_PATTERNS.some(p => p.test(raw))) {
    return {
      message: 'File storage service is temporarily unavailable. Please try again later.',
      category: 'storage_error'
    }
  }

  if (PROMPT_PATTERNS.some(p => p.test(raw))) {
    return {
      message: 'Your project description could not be processed. Try rephrasing it with more detail about the entities and features you need.',
      category: 'prompt_error'
    }
  }

  return {
    message: 'An unexpected error occurred. Please try again.',
    category: 'internal_error'
  }
}
