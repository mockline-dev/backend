import type { Application } from '../declarations'
import { ollamaClient, OllamaMessage } from '../llm/ollama.client'
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

export class AgentEngine {
  private app: Application

  constructor(app: Application) {
    this.app = app
  }

  async run(options: AgentRunOptions): Promise<void> {
    const { projectId, systemPrompt, userMessage, history = [], maxIterations = 15, onEvent } = options

    const messages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userMessage }
    ]

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      let responseContent = ''
      let pendingToolCalls: any[] = []

      try {
        for await (const chunk of ollamaClient.chatStream(messages, AGENT_TOOLS, {
          temperature: 0.1
        })) {
          if (chunk.message.content) {
            responseContent += chunk.message.content
            onEvent({ type: 'token', payload: chunk.message.content })
          }
          if (chunk.message.tool_calls?.length) {
            pendingToolCalls = chunk.message.tool_calls
          }
        }
      } catch (err: any) {
        onEvent({ type: 'error', payload: { message: `LLM error: ${err.message}` } })
        return
      }

      const assistantMsg: OllamaMessage = {
        role: 'assistant',
        content: responseContent
      }
      if (pendingToolCalls.length) {
        ;(assistantMsg as any).tool_calls = pendingToolCalls
      }
      messages.push(assistantMsg)

      if (!pendingToolCalls.length) {
        onEvent({ type: 'done', payload: { summary: responseContent } })
        return
      }

      for (const toolCall of pendingToolCalls) {
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

        const result: ToolResult = await executeToolCall(name, args, projectId, this.app)
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
