import type { Application } from '../../declarations'
import type { ChatMessage, OllamaClient } from '../../llm/client'
import { getModelConfig } from '../../llm/client'
import { agenticLoop, type IterationEvent } from '../../llm/tool-calling'

import { AGENT_TOOLS } from '../tools/definitions'
import { createToolExecutor } from './tool-executor'

// ─── System prompt ────────────────────────────────────────────────────────────

const EDIT_SYSTEM_PROMPT = `You are an AI assistant that modifies Python/FastAPI projects.
You MUST use tools to complete this task. Do NOT explain what you would do — DO it by calling tools.

MANDATORY TOOL SEQUENCE:
1. Call list_files to see the project structure
2. Call read_file on relevant files before editing
3. Call edit_file with exact search/replace blocks
4. Call run_validation to verify changes compile correctly
5. If validation fails, read the errors and fix them with more edit_file calls
6. Call done() with a summary when the task is complete

TOOL USAGE RULES:
- ALWAYS start by calling list_files — never skip this step
- ALWAYS read a file before editing it
- Use edit_file with exact search/replace, never rewrite entire files
- After all changes, call run_validation before calling done()
- If the same tool is called 3 times with the same arguments, try a different approach
- Call done() ONLY when all changes are verified working`

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EditSessionResult {
  summary: string
  success: boolean
  iterations: number
  /** Simplified conversation history for storage (user turn + assistant summary). */
  messages: ChatMessage[]
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Executes one edit session for a project.
 *
 * Wires together:
 *   - the EDIT_SYSTEM_PROMPT
 *   - the per-project tool executor (reads/writes files via R2 + MongoDB)
 *   - agenticLoop from src/llm/tool-calling.ts
 *
 * @param client              OllamaClient instance
 * @param projectId           Target project
 * @param userMessage         The user's edit request
 * @param conversationHistory Previous turns (empty for a fresh conversation)
 * @param app                 FeathersJS Application for service access
 * @param onIteration         Called after every loop iteration for progress reporting
 */
export async function executeEditSession(
  client: OllamaClient,
  projectId: string,
  userMessage: string,
  conversationHistory: ChatMessage[],
  app: Application,
  onIteration: (iteration: number, detail: IterationEvent) => void
): Promise<EditSessionResult> {
  const toolExecutor = createToolExecutor(projectId, app)

  const messages: ChatMessage[] = [
    { role: 'system', content: EDIT_SYSTEM_PROMPT },
    ...conversationHistory,
    { role: 'user', content: userMessage }
  ]

  const editModelCfg = getModelConfig('editing')
  const result = await agenticLoop(client, AGENT_TOOLS, toolExecutor, messages, {
    maxIterations: 15,
    model: editModelCfg.name,
    think: editModelCfg.think,
    onIteration: (event: IterationEvent) => onIteration(event.iteration, event)
  })

  return {
    summary: result.summary,
    success: result.success,
    iterations: result.iterations,
    // Store a lightweight version of the conversation (prior history + this turn)
    messages: [
      ...conversationHistory,
      { role: 'user', content: userMessage },
      { role: 'assistant', content: result.summary }
    ]
  }
}
