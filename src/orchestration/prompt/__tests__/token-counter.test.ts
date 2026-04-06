import { describe, it, expect } from 'vitest'
import { countTokens, countMessages } from '../token-counter'
import type { LLMMessage } from '../../types'

describe('countTokens', () => {
  it('returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0)
  })

  it('counts tokens for a short string', () => {
    const count = countTokens('Hello world')
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(4)
  })

  it('counts more tokens for longer text', () => {
    const short = countTokens('Hi')
    const long = countTokens('This is a much longer sentence with many more words and tokens in it.')
    expect(long).toBeGreaterThan(short)
  })

  it('returns consistent results for the same input', () => {
    const text = 'Consistent text for testing'
    expect(countTokens(text)).toBe(countTokens(text))
  })

  it('counts code tokens reasonably', () => {
    const code = `def hello_world():\n    print("Hello, World!")\n    return True`
    const count = countTokens(code)
    expect(count).toBeGreaterThan(10)
    expect(count).toBeLessThan(50)
  })
})

describe('countMessages', () => {
  it('returns 0 for empty array', () => {
    expect(countMessages([])).toBe(0)
  })

  it('includes per-message overhead', () => {
    const messages: LLMMessage[] = [{ role: 'user', content: 'hi' }]
    // Should be content tokens + 4 overhead
    const contentTokens = countTokens('hi')
    expect(countMessages(messages)).toBe(contentTokens + 4)
  })

  it('accumulates tokens across multiple messages', () => {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are an assistant.' },
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: 'The answer is 4.' }
    ]
    const single = countMessages([messages[0]])
    const all = countMessages(messages)
    expect(all).toBeGreaterThan(single)
  })
})
