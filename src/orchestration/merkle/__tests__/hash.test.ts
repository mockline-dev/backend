import { describe, it, expect } from 'vitest'
import { hashContent, computeRootHash } from '../hash'

describe('hashContent', () => {
  it('returns a 64-char hex string', () => {
    const h = hashContent('hello')
    expect(h).toHaveLength(64)
    expect(h).toMatch(/^[0-9a-f]+$/)
  })

  it('is deterministic', () => {
    expect(hashContent('hello')).toBe(hashContent('hello'))
  })

  it('differs for different content', () => {
    expect(hashContent('hello')).not.toBe(hashContent('world'))
  })

  it('handles empty string', () => {
    expect(hashContent('')).toHaveLength(64)
  })
})

describe('computeRootHash', () => {
  it('returns empty-hash for no files', () => {
    expect(computeRootHash([])).toBe(hashContent(''))
  })

  it('is order-independent', () => {
    const files = [
      { path: 'b.ts', hash: 'bbb' },
      { path: 'a.ts', hash: 'aaa' }
    ]
    const reversed = [...files].reverse()
    expect(computeRootHash(files)).toBe(computeRootHash(reversed))
  })

  it('changes when a file hash changes', () => {
    const files = [{ path: 'a.ts', hash: 'aaa' }]
    const modified = [{ path: 'a.ts', hash: 'bbb' }]
    expect(computeRootHash(files)).not.toBe(computeRootHash(modified))
  })

  it('changes when a file is added', () => {
    const before = [{ path: 'a.ts', hash: 'aaa' }]
    const after = [...before, { path: 'b.ts', hash: 'bbb' }]
    expect(computeRootHash(before)).not.toBe(computeRootHash(after))
  })
})
