import { z } from 'zod'

import { logger } from '../logger'

import type { OllamaClient, ChatMessage } from './client'

// ─── Error type ───────────────────────────────────────────────────────────────

export class StructuredOutputError extends Error {
  readonly zodErrors: string

  constructor(message: string, zodErrors: string) {
    super(message)
    this.name = 'StructuredOutputError'
    this.zodErrors = zodErrors
  }
}

// ─── Think-tag stripping ──────────────────────────────────────────────────────

/**
 * Strips <think>...</think> blocks from qwen3 responses before JSON parsing.
 * Also handles unclosed tags (truncation) and markdown code fences.
 */
export function stripThinkTags(content: string): string {
  // Remove complete <think>...</think> blocks (multiline)
  let stripped = content.replace(/<think>[\s\S]*?<\/think>/g, '')

  // Remove incomplete think blocks (truncated response)
  stripped = stripped.replace(/<think>[\s\S]*/g, '')

  stripped = stripped.trim()

  // Extract JSON from markdown code fence if present
  const jsonMatch = stripped.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (jsonMatch) {
    stripped = jsonMatch[1].trim()
  }

  return stripped
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface StructuredOutputOptions {
  temperature?: number
  think?: boolean
  maxRetries?: number
  /** Override the model for this call (uses client default if not specified). */
  model?: string
}

// ─── Core function ────────────────────────────────────────────────────────────

/**
 * Calls OllamaClient in JSON mode and validates the response with a Zod schema.
 *
 * On failure the model receives the exact Zod error message so it can self-correct.
 * Retries up to `maxRetries` times (default 3) before throwing StructuredOutputError.
 */
export async function structuredLLMCall<T>(
  client: OllamaClient,
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  options: StructuredOutputOptions = {}
): Promise<T> {
  const { temperature, think, maxRetries = 3, model } = options

  // Work on a mutable copy so retry messages accumulate without mutating caller's array
  const conversation: ChatMessage[] = [...messages]
  let lastZodError = ''

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    logger.debug('structuredLLMCall: attempt %d/%d', attempt, maxRetries)

    const response = await client.chat({
      model,
      messages: conversation,
      temperature,
      think,
      format: 'json'
    })

    // Strip <think>...</think> blocks from qwen3 responses before parsing
    const raw = stripThinkTags(response.content)

    // ── Step 1: parse as JSON ────────────────────────────────────────────────
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      lastZodError = `Response was not valid JSON: ${raw.slice(0, 200)}`
      logger.warn('structuredLLMCall: attempt %d — invalid JSON', attempt)

      conversation.push(
        { role: 'assistant', content: raw },
        {
          role: 'user',
          content:
            'Your response was not valid JSON. Fix it and respond with ONLY valid JSON matching the required schema.'
        }
      )
      continue
    }

    // ── Step 2: validate against Zod schema ──────────────────────────────────
    const result = schema.safeParse(parsed)
    if (result.success) {
      logger.debug('structuredLLMCall: attempt %d — success', attempt)
      return result.data
    }

    lastZodError = result.error.toString()
    logger.warn(
      'structuredLLMCall: attempt %d — schema mismatch: %s',
      attempt,
      lastZodError
    )

    conversation.push(
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content: `Your response failed validation: ${lastZodError}. Fix the JSON to match the required schema. Respond with ONLY valid JSON.`
      }
    )
  }

  throw new StructuredOutputError(
    `structuredLLMCall failed after ${maxRetries} attempt(s)`,
    lastZodError
  )
}
