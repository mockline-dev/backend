import { describe, expect, it } from 'vitest'

import { applySearchReplace } from '../edit-applier'

describe('applySearchReplace', () => {
  const BASE = `def hello():\n    return "hello"\n\ndef world():\n    return "world"\n`

  it('replaces an exact match', () => {
    const result = applySearchReplace(BASE, 'return "hello"', 'return "hi"')
    expect(result.success).toBe(true)
    expect(result.result).toContain('return "hi"')
    expect(result.result).not.toContain('return "hello"')
  })

  it('normalises CRLF line endings before matching', () => {
    const crlfContent = BASE.replace(/\n/g, '\r\n')
    const result = applySearchReplace(crlfContent, 'return "hello"', 'return "hi"')
    expect(result.success).toBe(true)
    expect(result.result).toContain('return "hi"')
  })

  it('falls back to fuzzy whitespace normalisation', () => {
    // Content has extra spaces; search has collapsed spaces — should still match
    const content = `def foo():\n    x  =  1\n    return x\n`
    const result = applySearchReplace(content, 'x  =  1', 'x = 42')
    expect(result.success).toBe(true)
    expect(result.result).toContain('x = 42')
  })

  it('returns an error when the search block is not found', () => {
    const result = applySearchReplace(BASE, 'nonexistent block', 'replacement')
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.result).toBe(BASE) // original content unchanged
  })

  it('replaces only the first occurrence when the search appears multiple times', () => {
    const content = `a = 1\na = 1\na = 1\n`
    const result = applySearchReplace(content, 'a = 1', 'a = 2')
    expect(result.success).toBe(true)
    const lines = result.result.split('\n').filter(l => l.trim())
    expect(lines[0]).toBe('a = 2')
    // remaining occurrences are unchanged
    expect(lines[1]).toBe('a = 1')
    expect(lines[2]).toBe('a = 1')
  })

  it('returns an error when search is empty', () => {
    const result = applySearchReplace(BASE, '', 'replacement')
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('preserves content before and after the replaced block', () => {
    const content = `line1\nTARGET\nline3\n`
    const result = applySearchReplace(content, 'TARGET', 'REPLACED')
    expect(result.success).toBe(true)
    expect(result.result).toBe('line1\nREPLACED\nline3\n')
  })
})
