import { logger } from '../logger'
import type { ToolCall, ToolResult } from '../types'

import type { OllamaClient, ChatMessage, ChatToolCall } from './client'
import { stripThinkTags } from './structured-output'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface AgenticLoopOptions {
  maxIterations?: number
  onIteration?: (event: IterationEvent) => void
  think?: boolean
  /** Override the model for this agentic loop (uses client default if not specified). */
  model?: string
}

export type IterationEvent =
  | { iteration: number; type: 'text'; text: string }
  | { iteration: number; type: 'tool_call'; toolName: string; args: Record<string, unknown>; result: ToolResult }
  | { iteration: number; type: 'done'; toolName: string; args: Record<string, unknown> }
  | { iteration: number; type: 'error'; text: string }

export interface AgenticLoopResult {
  summary: string
  success: boolean
  iterations: number
}

// ─── Context compression constants ───────────────────────────────────────────

/** 12K token budget, estimated at 4 chars/token. */
const CONTEXT_CHAR_LIMIT = 12_000 * 4

/** Older tool results are truncated to this many chars when compressing. */
const COMPRESSED_TOOL_RESULT_CHARS = 200

/** Number of most-recent tool-call+result pairs to keep verbatim. */
const KEEP_TOOL_PAIRS = 3

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Executes a tool-calling agent loop.
 *
 * The loop continues until:
 *   - The model calls the "done" or "finish" tool  → success
 *   - The model returns a text-only response        → success (model decided it's done)
 *   - maxIterations is reached                      → failure
 *
 * Context is compressed when the message history exceeds 12K tokens to prevent
 * OOM on the local GPU. Older tool results are truncated first; entire pairs are
 * dropped only if still over the limit.
 */
export async function agenticLoop(
  client: OllamaClient,
  tools: object[],
  toolExecutor: (call: ToolCall) => Promise<ToolResult>,
  messages: ChatMessage[],
  options: AgenticLoopOptions = {}
): Promise<AgenticLoopResult> {
  const { maxIterations = 15, onIteration, think, model } = options

  // Work on a local copy — don't mutate the caller's array
  const conversation: ChatMessage[] = [...messages]

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    trimContext(conversation)

    const response = await client.chat({
      model,
      messages: conversation,
      tools,
      think,
      temperature: 0.1
    })

    // ── Text response: model is thinking out loud or done ────────────────────
    if (!response.tool_calls || response.tool_calls.length === 0) {
      // Strip think tags from text content (qwen3 includes reasoning in text)
      const text = stripThinkTags(response.content) || response.content
      conversation.push({ role: 'assistant', content: text })
      onIteration?.({ iteration, type: 'text', text })
      logger.debug('agenticLoop[%d]: text response — treating as completion', iteration)
      return { summary: text, success: true, iterations: iteration }
    }

    // ── Tool calls: append assistant turn then execute each ──────────────────
    conversation.push({
      role: 'assistant',
      content: response.content,
      tool_calls: response.tool_calls
    })

    for (const toolCall of response.tool_calls) {
      const { name, args } = parseToolCall(toolCall)

      // Terminal tool: model signals it's done
      if (name === 'done' || name === 'finish') {
        const summary = typeof args.summary === 'string' ? args.summary : response.content
        onIteration?.({ iteration, type: 'done', toolName: name, args })
        logger.debug('agenticLoop[%d]: terminal tool "%s" — stopping', iteration, name)
        return { summary, success: true, iterations: iteration }
      }

      logger.debug('agenticLoop[%d]: executing tool "%s"', iteration, name)

      let result: ToolResult
      try {
        result = await toolExecutor({ name, arguments: args })
        logger.debug('agenticLoop[%d]: tool "%s" succeeded', iteration, name)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        result = { name, result: `Error: ${message}`, success: false }
        logger.warn('agenticLoop[%d]: tool "%s" failed: %s', iteration, name, message)
      }

      onIteration?.({ iteration, type: 'tool_call', toolName: name, args, result })

      conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name,
        content: JSON.stringify(result)
      })
    }
  }

  const errorMsg = `Max agent iterations (${maxIterations}) reached without completion`
  onIteration?.({ iteration: maxIterations, type: 'error', text: errorMsg })
  logger.warn('agenticLoop: %s', errorMsg)

  return { summary: errorMsg, success: false, iterations: maxIterations }
}

// ─── Context compression ──────────────────────────────────────────────────────

/**
 * Compresses the conversation in-place when it exceeds CONTEXT_CHAR_LIMIT.
 *
 * Strategy (matches engine.ts smartTrimMessages):
 *  1. System/user messages — always kept verbatim
 *  2. Last KEEP_TOOL_PAIRS assistant+tool pairs — kept verbatim
 *  3. Older pairs — tool results truncated to COMPRESSED_TOOL_RESULT_CHARS
 *  4. If still over limit — oldest compressed pairs dropped entirely
 */
export function trimContext(messages: ChatMessage[]): void {
  if (totalChars(messages) <= CONTEXT_CHAR_LIMIT) return

  const pairs = findToolPairs(messages)
  const compressUntil = Math.max(0, pairs.length - KEEP_TOOL_PAIRS)

  // Pass 1: truncate older tool result content
  for (let p = 0; p < compressUntil; p++) {
    for (const idx of pairs[p].toolIdxs) {
      const msg = messages[idx]
      if ((msg.content?.length ?? 0) > COMPRESSED_TOOL_RESULT_CHARS) {
        messages[idx] = {
          ...msg,
          content: msg.content!.slice(0, COMPRESSED_TOOL_RESULT_CHARS) + ' …[compressed]'
        }
      }
    }
  }

  if (totalChars(messages) <= CONTEXT_CHAR_LIMIT) return

  // Pass 2: drop entire pairs from oldest until under limit
  for (let p = 0; p < compressUntil && totalChars(messages) > CONTEXT_CHAR_LIMIT; p++) {
    const { assistantIdx, toolIdxs } = pairs[p]
    const removeSet = new Set([assistantIdx, ...toolIdxs])
    const toRemove = [...removeSet].sort((a, b) => b - a)
    for (const idx of toRemove) {
      messages.splice(idx, 1)
    }
    // Adjust indices of subsequent pairs after the splice
    const shift = removeSet.size
    for (let q = p + 1; q < pairs.length; q++) {
      pairs[q].assistantIdx -= shift
      pairs[q].toolIdxs = pairs[q].toolIdxs.map(i => i - shift)
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseToolCall(toolCall: ChatToolCall): { name: string; args: Record<string, unknown> } {
  const name = toolCall.function.name
  let args: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(toolCall.function.arguments)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      args = parsed as Record<string, unknown>
    }
  } catch {
    // Malformed JSON args — use empty object
  }
  return { name, args }
}

function findToolPairs(
  messages: ChatMessage[]
): Array<{ assistantIdx: number; toolIdxs: number[] }> {
  const pairs: Array<{ assistantIdx: number; toolIdxs: number[] }> = []

  for (let i = 1; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      const toolIdxs: number[] = []
      let j = i + 1
      while (j < messages.length && messages[j].role === 'tool') {
        toolIdxs.push(j)
        j++
      }
      if (toolIdxs.length > 0) {
        pairs.push({ assistantIdx: i, toolIdxs })
        i = j - 1
      }
    }
  }

  return pairs
}

function totalChars(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0)
}
