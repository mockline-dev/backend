import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

import { structuredLLMCall, StructuredOutputError } from '../structured-output'
import type { OllamaClient, ChatOptions, ChatResponse } from '../client'

// ─── Mock client factory ──────────────────────────────────────────────────────

function makeMockClient(responses: ChatResponse[]): OllamaClient {
  let callIndex = 0
  return {
    chat: vi.fn(async (_options: ChatOptions): Promise<ChatResponse> => {
      const resp = responses[callIndex]
      if (!resp) throw new Error(`No more mock responses (call ${callIndex})`)
      callIndex++
      return resp
    })
  } as unknown as OllamaClient
}

// ─── Schema fixture ───────────────────────────────────────────────────────────

const PersonSchema = z.object({
  name: z.string(),
  age: z.number().int().positive()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('structuredLLMCall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns typed data when the first response is valid', async () => {
    const client = makeMockClient([
      { content: JSON.stringify({ name: 'Alice', age: 30 }) }
    ])

    const result = await structuredLLMCall(client, PersonSchema, [
      { role: 'user', content: 'Give me a person.' }
    ])

    expect(result).toEqual({ name: 'Alice', age: 30 })
    expect(client.chat).toHaveBeenCalledTimes(1)
  })

  it('retries and succeeds when first response is invalid JSON', async () => {
    const client = makeMockClient([
      { content: 'not json at all' },
      { content: JSON.stringify({ name: 'Bob', age: 25 }) }
    ])

    const result = await structuredLLMCall(client, PersonSchema, [
      { role: 'user', content: 'Give me a person.' }
    ])

    expect(result).toEqual({ name: 'Bob', age: 25 })
    expect(client.chat).toHaveBeenCalledTimes(2)

    // Second call must include the error feedback messages appended by the retry loop
    const secondCallMessages = (client.chat as ReturnType<typeof vi.fn>).mock.calls[1][0].messages
    const roles = secondCallMessages.map((m: { role: string }) => m.role)
    expect(roles).toContain('assistant')
    expect(roles.at(-1)).toBe('user') // error feedback is the last message
  })

  it('retries and succeeds when JSON is valid but does not match schema', async () => {
    const client = makeMockClient([
      { content: JSON.stringify({ name: 'Carol', age: 'not-a-number' }) }, // age wrong type
      { content: JSON.stringify({ name: 'Carol', age: 28 }) }
    ])

    const result = await structuredLLMCall(client, PersonSchema, [
      { role: 'user', content: 'Give me a person.' }
    ])

    expect(result).toEqual({ name: 'Carol', age: 28 })
    expect(client.chat).toHaveBeenCalledTimes(2)

    // The feedback message must contain the Zod error description
    const secondCallMessages = (client.chat as ReturnType<typeof vi.fn>).mock.calls[1][0].messages
    const feedbackMsg = secondCallMessages.at(-1) as { role: string; content: string }
    expect(feedbackMsg.role).toBe('user')
    expect(feedbackMsg.content).toContain('failed validation')
  })

  it('throws StructuredOutputError after exhausting all retries', async () => {
    const badContent = JSON.stringify({ name: 'Dave', age: 'wrong' })
    const client = makeMockClient([
      { content: badContent },
      { content: badContent },
      { content: badContent }
    ])

    await expect(
      structuredLLMCall(client, PersonSchema, [{ role: 'user', content: 'Give me a person.' }], {
        maxRetries: 3
      })
    ).rejects.toThrow(StructuredOutputError)

    expect(client.chat).toHaveBeenCalledTimes(3)
  })

  it('StructuredOutputError carries the last Zod error message', async () => {
    const client = makeMockClient([{ content: '{"missing":"fields"}' }])

    let caughtError: unknown
    try {
      await structuredLLMCall(client, PersonSchema, [{ role: 'user', content: 'test' }], {
        maxRetries: 1
      })
    } catch (err) {
      caughtError = err
    }

    expect(caughtError).toBeInstanceOf(StructuredOutputError)
    expect((caughtError as StructuredOutputError).zodErrors).toBeTruthy()
  })

  it('passes temperature and think options to the client', async () => {
    const client = makeMockClient([
      { content: JSON.stringify({ name: 'Eve', age: 22 }) }
    ])

    await structuredLLMCall(client, PersonSchema, [{ role: 'user', content: 'test' }], {
      temperature: 0.1,
      think: false
    })

    const callArgs = (client.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as ChatOptions
    expect(callArgs.temperature).toBe(0.1)
    expect(callArgs.think).toBe(false)
    expect(callArgs.format).toBe('json')
  })
})
