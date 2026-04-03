import type { Application } from '../declarations'
import { getProvider } from '../llm/providers/registry'
import type { OllamaMessage, OllamaToolCall } from '../llm/ollama.client'
import { ContextRetriever } from './rag/retriever'
import { AGENT_TOOLS } from './tools/definitions'
import { executeToolCall, ToolResult } from './tools/executor'

export type AgentEventType = 'token' | 'tool_call' | 'tool_result' | 'done' | 'error'

export type AgentEvent =
  | { type: 'token'; payload: string }
  | { type: 'tool_call'; payload: { name: string; args: Record<string, unknown> } }
  | { type: 'tool_result'; payload: { name: string; result: ToolResult } }
  | { type: 'done'; payload: { summary: string } }
  | { type: 'error'; payload: { message: string } }

export interface AgentRunOptions {
  projectId: string
  systemPrompt: string
  userMessage: string
  history?: OllamaMessage[]
  maxIterations?: number
  onEvent: (event: AgentEvent) => void
}

const TOOL_EXECUTION_TIMEOUT_MS = 30_000

/**
 * Context budget: 12K tokens estimated at 4 chars/token.
 * Matches the plan spec — leaves ample room for system prompt + new response.
 */
const CONTEXT_CHAR_LIMIT = 12_000 * 4

/**
 * Older tool results beyond this many recent pairs are compressed to a brief summary.
 * The last KEEP_TOOL_PAIRS tool-call+result exchanges are always kept verbatim.
 */
const KEEP_TOOL_PAIRS = 3

/** Max chars kept from an older tool result when compressing. */
const COMPRESSED_TOOL_RESULT_CHARS = 200

export class AgentEngine {
  private app: Application

  constructor(app: Application) {
    this.app = app
  }

  async run(options: AgentRunOptions): Promise<void> {
    const { projectId, systemPrompt, userMessage, history = [], maxIterations = 15, onEvent } = options

    // Augment the system prompt with relevant file context from RAG
    const retriever = new ContextRetriever(this.app)
    const relevantFiles = await retriever.getRelevantFiles(projectId, userMessage, 5)
    const contextBlock =
      relevantFiles.length > 0
        ? `\n\nRelevant project files for this task:\n${relevantFiles.map(f => `=== ${f.path} ===\n${f.content}`).join('\n\n')}`
        : ''

    const messages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt + contextBlock },
      ...history,
      { role: 'user', content: userMessage }
    ]

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // Smart context compression before each LLM call
      smartTrimMessages(messages)

      let responseContent = ''
      const pendingToolCalls = new Map<string, OllamaToolCall>()

      try {
        for await (const chunk of getProvider().chatStream(messages, AGENT_TOOLS, {
          temperature: 0.1
        })) {
          if (chunk.message.content) {
            responseContent += chunk.message.content
            onEvent({ type: 'token', payload: chunk.message.content })
          }
          // Accumulate tool calls by id to handle streaming chunks
          if (chunk.message.tool_calls?.length) {
            for (const toolCall of chunk.message.tool_calls) {
              const id = toolCall.id || `tc-${pendingToolCalls.size}`
              const existing = pendingToolCalls.get(id)
              if (existing) {
                // Merge streamed argument chunks
                existing.function.arguments += toolCall.function.arguments
              } else {
                pendingToolCalls.set(id, { ...toolCall })
              }
            }
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        onEvent({ type: 'error', payload: { message: `LLM error: ${message}` } })
        return
      }

      const toolCallsArr = Array.from(pendingToolCalls.values())
      const assistantMsg: OllamaMessage = {
        role: 'assistant',
        content: responseContent,
        tool_calls: toolCallsArr.length > 0 ? toolCallsArr : undefined
      }
      messages.push(assistantMsg)

      if (toolCallsArr.length === 0) {
        onEvent({ type: 'done', payload: { summary: responseContent } })
        return
      }

      for (const toolCall of toolCallsArr) {
        const name = toolCall.function.name
        let args: Record<string, unknown> = {}
        try {
          const parsed: unknown = JSON.parse(toolCall.function.arguments)
          args = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {}
        } catch {
          // arguments not valid JSON — leave args as empty object
        }

        onEvent({ type: 'tool_call', payload: { name, args } })

        if (name === 'done' || name === 'finish') {
          const summary = typeof args.summary === 'string' ? args.summary : ''
          onEvent({ type: 'done', payload: { summary } })
          return
        }

        // Execute tool with timeout
        let result: ToolResult
        try {
          result = await Promise.race([
            executeToolCall(name, args, projectId, this.app),
            new Promise<ToolResult>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Tool ${name} timed out after ${TOOL_EXECUTION_TIMEOUT_MS}ms`)),
                TOOL_EXECUTION_TIMEOUT_MS
              )
            )
          ])
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          result = { success: false, error: message }
        }

        onEvent({ type: 'tool_result', payload: { name, result } })

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name,
          content: JSON.stringify(result)
        })
      }
    }

    onEvent({
      type: 'error',
      payload: { message: 'Max agent iterations reached without completion' }
    })
  }
}

// ---------------------------------------------------------------------------
// Smart context compression
// ---------------------------------------------------------------------------

/**
 * Compress the conversation in-place to stay within CONTEXT_CHAR_LIMIT.
 *
 * Strategy (from the plan spec):
 *   1. System message (index 0) — always kept verbatim
 *   2. User messages — always kept verbatim
 *   3. Last KEEP_TOOL_PAIRS assistant+tool message pairs — kept verbatim
 *   4. Older assistant+tool pairs — tool result compressed to COMPRESSED_TOOL_RESULT_CHARS
 *   5. If still over limit, drop oldest compressed pairs
 */
export function smartTrimMessages(messages: OllamaMessage[]): void {
  if (totalChars(messages) <= CONTEXT_CHAR_LIMIT) return

  // Identify assistant+tool pairs in order (tool call followed by its results)
  // A pair is: assistant message with tool_calls[] + one or more following tool messages
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

  // Compress older pairs (keep last KEEP_TOOL_PAIRS verbatim)
  const compressUntil = Math.max(0, pairs.length - KEEP_TOOL_PAIRS)
  for (let p = 0; p < compressUntil; p++) {
    const { toolIdxs } = pairs[p]
    for (const idx of toolIdxs) {
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

  // Still over limit: drop oldest compressed pairs entirely
  for (let p = 0; p < compressUntil && totalChars(messages) > CONTEXT_CHAR_LIMIT; p++) {
    const { assistantIdx, toolIdxs } = pairs[p]
    const removeSet = new Set([assistantIdx, ...toolIdxs])
    // Splice from highest index to lowest to preserve earlier indices
    const toRemove = [...removeSet].sort((a, b) => b - a)
    for (const idx of toRemove) {
      messages.splice(idx, 1)
    }
    // Adjust subsequent pair indices since we shifted the array
    for (let q = p + 1; q < pairs.length; q++) {
      const shift = removeSet.size
      pairs[q].assistantIdx -= shift
      pairs[q].toolIdxs = pairs[q].toolIdxs.map(i => i - shift)
    }
  }
}

function totalChars(messages: OllamaMessage[]): number {
  return messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0)
}
