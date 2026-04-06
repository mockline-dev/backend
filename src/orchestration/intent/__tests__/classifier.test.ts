import { describe, it, expect, vi } from 'vitest'
import { classifyIntent } from '../classifier'
import { Intent } from '../../types'
import type { ILLMProvider, LLMResponse } from '../../types'

function mockProviderWithResponse(content: string): ILLMProvider {
  const response: LLMResponse = {
    content,
    model: 'test-model',
    provider: 'test',
    usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
    finishReason: 'stop',
  }
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn(),
  }
}

describe('classifyIntent', () => {
  it('returns classified intent from valid JSON response', async () => {
    const provider = mockProviderWithResponse(
      JSON.stringify({ intent: 'edit_code', confidence: 0.95, entities: { framework: 'FastAPI' } })
    )
    const result = await classifyIntent('Change the user model to add an email field', provider)
    expect(result.intent).toBe(Intent.EditCode)
    expect(result.confidence).toBe(0.95)
    expect(result.entities.framework).toBe('FastAPI')
  })

  it('returns General with low confidence on invalid JSON', async () => {
    const provider = mockProviderWithResponse('not valid json at all {{')
    const result = await classifyIntent('some query', provider)
    expect(result.intent).toBe(Intent.General)
    expect(result.confidence).toBe(0.5)
  })

  it('returns General when provider throws', async () => {
    const provider: ILLMProvider = {
      name: 'failing',
      chat: vi.fn().mockRejectedValue(new Error('network error')),
      chatStream: vi.fn(),
    }
    const result = await classifyIntent('some query', provider)
    expect(result.intent).toBe(Intent.General)
    expect(result.confidence).toBe(0.5)
  })

  it('defaults to General for unknown intent value', async () => {
    const provider = mockProviderWithResponse(
      JSON.stringify({ intent: 'do_something_unknown', confidence: 0.9, entities: {} })
    )
    const result = await classifyIntent('some query', provider)
    expect(result.intent).toBe(Intent.General)
  })

  it('recognizes generate_project intent', async () => {
    const provider = mockProviderWithResponse(
      JSON.stringify({ intent: 'generate_project', confidence: 0.98, entities: { language: 'Python' } })
    )
    const result = await classifyIntent('Create a FastAPI todo app', provider)
    expect(result.intent).toBe(Intent.GenerateProject)
    expect(result.entities.language).toBe('Python')
  })

  it('recognizes all valid intent values', async () => {
    for (const intent of Object.values(Intent)) {
      const provider = mockProviderWithResponse(
        JSON.stringify({ intent, confidence: 0.9, entities: {} })
      )
      const result = await classifyIntent('test query', provider)
      expect(result.intent).toBe(intent)
    }
  })

  it('handles missing entities gracefully', async () => {
    const provider = mockProviderWithResponse(
      JSON.stringify({ intent: 'fix_bug', confidence: 0.8 }) // no entities key
    )
    const result = await classifyIntent('fix the login bug', provider)
    expect(result.intent).toBe(Intent.FixBug)
    expect(result.entities).toEqual({})
  })

  it('handles missing confidence gracefully', async () => {
    const provider = mockProviderWithResponse(
      JSON.stringify({ intent: 'explain_code', entities: {} }) // no confidence key
    )
    const result = await classifyIntent('explain the auth module', provider)
    expect(result.intent).toBe(Intent.ExplainCode)
    expect(result.confidence).toBe(0.8) // default
  })

  it('passes classifierModel option to provider', async () => {
    const provider = mockProviderWithResponse(
      JSON.stringify({ intent: 'general', confidence: 0.7, entities: {} })
    )
    await classifyIntent('hello', provider, 'llama-3.1-8b-instant')
    expect(provider.chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ model: 'llama-3.1-8b-instant' })
    )
  })
})
