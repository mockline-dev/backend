import type { Application } from '../declarations'
import { getProvider } from '../llm/providers/registry'
import type { OllamaMessage, OllamaToolCall } from '../llm/ollama.client'
import { ContextRetriever } from './rag/retriever'
import { AGENT_TOOLS } from './tools/definitions'
import { executeToolCall, ToolResult } from './tools/executor'

export type AgentEventType = 'token' | 'tool_call' | 'tool_result' | 'done' | 'error'

export interface AgentEvent {
  type: AgentEventType
  payload: any
}

export interface AgentRunOptions {
  projectId: string
  systemPrompt: string
  userMessage: string
  history?: OllamaMessage[]
  maxIterations?: number
  onEvent: (event: AgentEvent) => void
}

const TOOL_EXECUTION_TIMEOUT_MS = 30_000
const CONTEXT_CHAR_LIMIT = 24_000 * 4 // ~24k tokens estimated at 4 chars/token

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
      // Trim messages to stay within context window before each LLM call
      this.trimMessages(messages)

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
      } catch (err: any) {
        onEvent({ type: 'error', payload: { message: `LLM error: ${err.message}` } })
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
        let args: any = {}
        try {
          args = JSON.parse(toolCall.function.arguments)
        } catch {
          args = toolCall.function.arguments
        }

        onEvent({ type: 'tool_call', payload: { name, args } })

        if (name === 'finish') {
          onEvent({ type: 'done', payload: { summary: args.summary } })
          return
        }

        // Execute tool with timeout
        let result: ToolResult
        try {
          result = await Promise.race([
            executeToolCall(name, args, projectId, this.app),
            new Promise<ToolResult>((_, reject) =>
              setTimeout(() => reject(new Error(`Tool ${name} timed out after ${TOOL_EXECUTION_TIMEOUT_MS}ms`)), TOOL_EXECUTION_TIMEOUT_MS)
            )
          ])
        } catch (err: any) {
          result = { success: false, error: err.message }
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

  /**
   * Trims the messages array in-place to stay within the estimated context window.
   * Always preserves the system prompt (index 0). Removes oldest non-system messages first.
   */
  private trimMessages(messages: OllamaMessage[]): void {
    const totalChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0)
    if (totalChars <= CONTEXT_CHAR_LIMIT) return

    // Keep system prompt (index 0) and trim from oldest non-system messages
    let i = 1
    let chars = totalChars
    while (chars > CONTEXT_CHAR_LIMIT && i < messages.length - 1) {
      chars -= messages[i].content?.length ?? 0
      messages.splice(i, 1)
      // Don't increment i — next element shifts down
    }
  }
}
