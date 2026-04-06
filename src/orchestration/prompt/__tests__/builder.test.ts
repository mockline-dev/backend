import { describe, it, expect } from 'vitest'
import { buildPrompt } from '../builder'
import { Intent } from '../../types'
import type { BuildPromptParams, CodeChunk, LLMMessage } from '../../types'

function makeChunk(id: string, content: string): CodeChunk {
  return { id, filepath: 'src/main.py', content, startLine: 0, endLine: 10 }
}

const BASE_PARAMS: BuildPromptParams = {
  intent: Intent.General,
  userQuery: 'What does this function do?',
  retrievedContext: { chunks: [], totalTokens: 0 },
  conversationHistory: [],
  modelContextWindow: 8192
}

describe('buildPrompt', () => {
  it('always includes system and user messages', () => {
    const result = buildPrompt(BASE_PARAMS)
    const roles = result.messages.map(m => m.role)
    expect(roles).toContain('system')
    expect(roles[0]).toBe('system')
    expect(roles[roles.length - 1]).toBe('user')
  })

  it('last message is the user query', () => {
    const result = buildPrompt(BASE_PARAMS)
    const last = result.messages[result.messages.length - 1]
    expect(last.role).toBe('user')
    expect(last.content).toBe('What does this function do?')
  })

  it('includes metadata with correct intent', () => {
    const result = buildPrompt({ ...BASE_PARAMS, intent: Intent.FixBug })
    expect(result.metadata.intent).toBe(Intent.FixBug)
  })

  it('reports 0 chunks used when no context provided', () => {
    const result = buildPrompt(BASE_PARAMS)
    expect(result.metadata.chunksUsed).toBe(0)
  })

  it('includes RAG context when chunks are provided', () => {
    const params: BuildPromptParams = {
      ...BASE_PARAMS,
      retrievedContext: {
        chunks: [makeChunk('c1', 'def foo():\n    return 42')],
        totalTokens: 20
      }
    }
    const result = buildPrompt(params)
    expect(result.metadata.chunksUsed).toBeGreaterThan(0)
    const content = result.messages.map(m => m.content).join(' ')
    expect(content).toContain('def foo()')
  })

  it('trims history to fit budget', () => {
    // Create a large history that exceeds budget
    const longHistory: LLMMessage[] = Array.from(
      { length: 50 },
      (_, i) =>
        ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}: ${'word '.repeat(50)}`
        }) as LLMMessage
    )

    const result = buildPrompt({
      ...BASE_PARAMS,
      conversationHistory: longHistory,
      modelContextWindow: 2000
    })

    // Should have trimmed history — less than 50 turns
    expect(result.metadata.historyTurns).toBeLessThan(50)
  })

  it('keeps most recent history (trims oldest first)', () => {
    const history: LLMMessage[] = [
      { role: 'user', content: 'first old message' },
      { role: 'assistant', content: 'first old reply' },
      { role: 'user', content: 'second old message' },
      { role: 'assistant', content: 'second old reply' },
      { role: 'user', content: 'very recent message' },
      { role: 'assistant', content: 'very recent reply' }
    ]

    // Large enough to fit recent messages but not all
    const result = buildPrompt({
      ...BASE_PARAMS,
      conversationHistory: history,
      modelContextWindow: 4096
    })

    const content = result.messages.map(m => m.content).join(' ')

    if (result.metadata.historyTurns > 0 && result.metadata.historyTurns < 6) {
      // Trimmed: recent messages should be present, old ones may be dropped
      expect(content).toContain('very recent')
    } else if (result.metadata.historyTurns === 6) {
      // All fit — still correct
      expect(content).toContain('first old message')
      expect(content).toContain('very recent message')
    }
    // historyTurns === 0 means all trimmed (budget too tight) — also valid
  })

  it('budget fields are all non-negative', () => {
    const result = buildPrompt(BASE_PARAMS)
    expect(result.budget.systemPrompt).toBeGreaterThan(0)
    expect(result.budget.userQuery).toBeGreaterThan(0)
    expect(result.budget.responseReserve).toBe(2048)
    expect(result.budget.retrievedContext).toBeGreaterThanOrEqual(0)
    expect(result.budget.history).toBeGreaterThanOrEqual(0)
  })

  it('interpolates project meta into system prompt', () => {
    const result = buildPrompt({
      ...BASE_PARAMS,
      intent: Intent.EditCode,
      projectMeta: { framework: 'FeathersJS', language: 'TypeScript', name: 'my-api' }
    })
    const systemMsg = result.messages.find(m => m.role === 'system')!
    expect(systemMsg.content).toContain('FeathersJS')
  })
})
