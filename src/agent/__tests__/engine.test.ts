import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentEngine, smartTrimMessages } from '../engine'
import type { AgentEvent } from '../engine'
import type { OllamaMessage } from '../../llm/ollama.client'

// ---------------------------------------------------------------------------
// Mock the LLM provider registry so no real Ollama call is made
// ---------------------------------------------------------------------------
vi.mock('../../llm/providers/registry', () => ({
  getProvider: vi.fn()
}))

import { getProvider } from '../../llm/providers/registry'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApp(fileRecords: Array<{ name: string; key: string }> = []) {
  return {
    service: vi.fn().mockReturnValue({
      find: vi.fn().mockResolvedValue({ data: fileRecords })
    })
  }
}

/** Build an async generator that yields the given chunks then returns done. */
async function* makeStream(
  chunks: Array<{ content?: string; tool_calls?: unknown[] }>
) {
  for (const chunk of chunks) {
    yield { message: chunk }
  }
}

// ---------------------------------------------------------------------------
// AgentEngine.run
// ---------------------------------------------------------------------------

describe('AgentEngine', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  describe('run', () => {
    it('emits token events from LLM text response and fires done', async () => {
      const mockProvider = {
        chatStream: vi.fn().mockReturnValue(
          makeStream([
            { content: 'Hello' },
            { content: ' World' }
          ])
        ),
        embed: vi.fn().mockResolvedValue([])
      }
      vi.mocked(getProvider).mockReturnValue(mockProvider as never)

      const engine = new AgentEngine(makeApp() as never)
      const events: AgentEvent[] = []

      await engine.run({
        projectId: 'proj-1',
        systemPrompt: 'You are a test assistant',
        userMessage: 'Say hello',
        onEvent: e => events.push(e)
      })

      expect(events.filter(e => e.type === 'token').map(e => e.payload)).toEqual(['Hello', ' World'])
      expect(events.at(-1)).toEqual({ type: 'done', payload: { summary: 'Hello World' } })
    })

    it('stops when the done tool is called', async () => {
      const mockProvider = {
        chatStream: vi.fn().mockReturnValue(
          makeStream([
            {
              tool_calls: [
                {
                  id: 'tc-1',
                  type: 'function' as const,
                  function: { name: 'done', arguments: '{"summary":"All done!"}' }
                }
              ]
            }
          ])
        ),
        embed: vi.fn().mockResolvedValue([])
      }
      vi.mocked(getProvider).mockReturnValue(mockProvider as never)

      const engine = new AgentEngine(makeApp() as never)
      const events: AgentEvent[] = []

      await engine.run({
        projectId: 'proj-1',
        systemPrompt: 'You are a test assistant',
        userMessage: 'Finish now',
        onEvent: e => events.push(e)
      })

      expect(events).toContainEqual({ type: 'done', payload: { summary: 'All done!' } })
    })

    it('emits error after max iterations without done tool', async () => {
      // The stream returns a tool_call on every iteration to keep the loop running
      const mockProvider = {
        chatStream: vi.fn().mockImplementation(() =>
          makeStream([
            {
              tool_calls: [
                { id: 'tc-1', type: 'function' as const, function: { name: 'list_files', arguments: '{}' } }
              ]
            }
          ])
        ),
        embed: vi.fn().mockResolvedValue([])
      }
      vi.mocked(getProvider).mockReturnValue(mockProvider as never)

      // executor's list_files calls r2Client — mock the app service that returns files
      const engine = new AgentEngine(makeApp() as never)
      const events: AgentEvent[] = []

      await engine.run({
        projectId: 'proj-1',
        systemPrompt: 'You are a test assistant',
        userMessage: 'Loop forever',
        maxIterations: 2,
        onEvent: e => events.push(e)
      })

      expect(events.at(-1)).toEqual({
        type: 'error',
        payload: { message: 'Max agent iterations reached without completion' }
      })
    })
  })
})

// ---------------------------------------------------------------------------
// smartTrimMessages (pure function — no LLM calls needed)
// ---------------------------------------------------------------------------

describe('smartTrimMessages', () => {
  const CHAR_LIMIT = 12_000 * 4

  function makeMsg(role: OllamaMessage['role'], content: string): OllamaMessage {
    return { role, content }
  }

  it('does nothing when under the limit', () => {
    const messages: OllamaMessage[] = [
      makeMsg('system', 'system'),
      makeMsg('user', 'hello'),
      makeMsg('assistant', 'world')
    ]
    const original = messages.map(m => ({ ...m }))
    smartTrimMessages(messages)
    expect(messages).toEqual(original)
  })

  it('always keeps the system message and all user messages', () => {
    // 5 pairs of 11,000 chars each → total tool content = 55,000 > 48,000
    const pairContent = 'x'.repeat(11_000)
    const messages: OllamaMessage[] = [makeMsg('system', 'sys'), makeMsg('user', 'user-1')]

    for (let i = 0; i < 5; i++) {
      messages.push({ role: 'assistant', content: '', tool_calls: [{ id: `tc-${i}`, type: 'function' as const, function: { name: 'read_file', arguments: '{}' } }] })
      messages.push(makeMsg('tool', pairContent))
    }
    messages.push(makeMsg('user', 'user-2'))

    smartTrimMessages(messages)

    expect(messages[0].content).toBe('sys')
    const userMessages = messages.filter(m => m.role === 'user')
    expect(userMessages.map(m => m.content)).toEqual(['user-1', 'user-2'])
  })

  it('compresses old tool results beyond KEEP_TOOL_PAIRS and reduces total chars', () => {
    // 5 pairs × 15,001 chars each = 75,005 total (> 48,000)
    // compressUntil = max(0, 5 - 3) = 2 pairs get compressed to 200 chars
    // After compression: 200 + 200 + 3 × 15,001 = 45,403 (< 48,000)
    const longResult = 'RESULT: ' + 'x'.repeat(14_993)  // ~15,001 chars total
    const messages: OllamaMessage[] = [makeMsg('system', 'sys')]

    for (let i = 0; i < 5; i++) {
      messages.push({ role: 'assistant', content: '', tool_calls: [{ id: `tc-${i}`, type: 'function' as const, function: { name: 'read_file', arguments: '{}' } }] })
      messages.push(makeMsg('tool', longResult))
    }

    smartTrimMessages(messages)

    // Compressed tool results (pairs 0+1) should have the compression marker
    const toolMessages = messages.filter(m => m.role === 'tool')
    const compressed = toolMessages.filter(m => m.content?.includes('…[compressed]'))
    expect(compressed.length).toBe(2)

    // Total chars should be within the limit
    const totalChars = messages.reduce((s, m) => s + (m.content?.length ?? 0), 0)
    expect(totalChars).toBeLessThanOrEqual(CHAR_LIMIT)
  })
})
