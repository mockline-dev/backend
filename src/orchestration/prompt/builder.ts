import { Intent } from '../types'
import type { BuildPromptParams, BuiltPrompt, LLMMessage, PromptBudget } from '../types'
import { countMessages, countTokens } from './token-counter'
import { getSystemPrompt } from './templates'

const DEFAULT_CONTEXT_WINDOW = 131072
const RESPONSE_RESERVE = 2048
const RAG_BUDGET_RATIO = 0.6
const HISTORY_BUDGET_RATIO = 0.4

/**
 * Assembles a token-budgeted prompt from intent, retrieved context, and conversation history.
 *
 * Budget allocation:
 *   - system prompt (fixed)
 *   - user query (fixed)
 *   - reserve 2048 for response
 *   - remaining: 60% RAG context, 40% history (history trimmed oldest-first)
 */
export function buildPrompt(params: BuildPromptParams): BuiltPrompt {
  const {
    intent,
    userQuery,
    retrievedContext,
    conversationHistory,
    projectMeta,
    modelContextWindow = DEFAULT_CONTEXT_WINDOW,
  } = params

  const systemContent = getSystemPrompt(intent, projectMeta)
  const systemTokens = countTokens(systemContent) + 4
  const queryTokens = countTokens(userQuery) + 4

  const available =
    modelContextWindow - systemTokens - queryTokens - RESPONSE_RESERVE
  const ragBudget = Math.floor(Math.max(0, available) * RAG_BUDGET_RATIO)
  const historyBudget = Math.floor(Math.max(0, available) * HISTORY_BUDGET_RATIO)

  // Pack RAG chunks into budget
  let ragContent = ''
  let chunksUsed = 0
  let ragTokensUsed = 0

  if (retrievedContext.chunks.length > 0) {
    const parts: string[] = []
    for (const chunk of retrievedContext.chunks) {
      const snippet = formatChunk(chunk)
      const snippetTokens = countTokens(snippet)
      if (ragTokensUsed + snippetTokens > ragBudget) break
      parts.push(snippet)
      ragTokensUsed += snippetTokens
      chunksUsed++
    }
    if (parts.length > 0) {
      ragContent = `Relevant code from the project:\n\n${parts.join('\n\n---\n\n')}`
    }
  }

  // Trim history oldest-first to fit budget
  const trimmedHistory: LLMMessage[] = []
  let historyTokensUsed = 0
  const reversed = [...conversationHistory].reverse()
  for (const msg of reversed) {
    const msgTokens = countTokens(msg.content) + 4
    if (historyTokensUsed + msgTokens > historyBudget) break
    trimmedHistory.unshift(msg)
    historyTokensUsed += msgTokens
  }

  // Assemble messages
  const messages: LLMMessage[] = [
    { role: 'system', content: systemContent },
    ...trimmedHistory,
  ]

  if (ragContent) {
    messages.push({ role: 'user', content: ragContent })
    messages.push({ role: 'assistant', content: 'Understood. I have reviewed the relevant code.' })
  }

  messages.push({ role: 'user', content: userQuery })

  const budget: PromptBudget = {
    systemPrompt: systemTokens,
    retrievedContext: ragTokensUsed,
    history: historyTokensUsed,
    userQuery: queryTokens,
    responseReserve: RESPONSE_RESERVE,
    total: modelContextWindow,
  }

  return {
    messages,
    budget,
    metadata: {
      intent,
      chunksUsed,
      historyTurns: trimmedHistory.length,
    },
  }
}

function formatChunk(chunk: { filepath: string; content: string; symbolName?: string; startLine: number; endLine: number }): string {
  const location = chunk.symbolName
    ? `${chunk.filepath} — ${chunk.symbolName} (lines ${chunk.startLine}-${chunk.endLine})`
    : `${chunk.filepath} (lines ${chunk.startLine}-${chunk.endLine})`
  const ext = chunk.filepath.split('.').pop() ?? ''
  return `\`\`\`${ext}\n# ${location}\n${chunk.content}\n\`\`\``
}
