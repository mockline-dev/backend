import type { Application } from '../../declarations'
import type { ToolCall, ToolResult } from '../../types'
import { executeToolCall } from '../tools/executor'

/**
 * Factory that creates a tool executor bound to a specific project.
 *
 * Returns a function that satisfies agenticLoop's toolExecutor signature:
 *   (toolCall: ToolCall) => Promise<ToolResult>
 *
 * It delegates to executeToolCall and converts its result format
 * ({ success, data?, error? }) to the ToolResult format used by agenticLoop
 * ({ name, result, success }).
 */
export function createToolExecutor(
  projectId: string,
  app: Application
): (toolCall: ToolCall) => Promise<ToolResult> {
  return async (toolCall: ToolCall): Promise<ToolResult> => {
    const executorResult = await executeToolCall(
      toolCall.name,
      toolCall.arguments,
      projectId,
      app
    )

    // Serialize the data or error into a string for the LLM to read
    const resultText = executorResult.success
      ? JSON.stringify(executorResult.data ?? { success: true })
      : (executorResult.error ?? 'Tool execution failed')

    return {
      name: toolCall.name,
      result: resultText,
      success: executorResult.success
    }
  }
}
