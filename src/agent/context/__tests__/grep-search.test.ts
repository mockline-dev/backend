import { describe, it, expect } from 'vitest'
import { grepSearch } from '../grep-search'
import type { SearchResult } from '../grep-search'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeFiles(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('grepSearch', () => {
  it('returns empty array when no files match', () => {
    const files = makeFiles({ 'app/main.py': 'import os\n\ndef foo(): pass' })
    const results = grepSearch(files, 'zxqvbnm')
    expect(results).toEqual([])
  })

  it('finds files containing query keywords', () => {
    const files = makeFiles({
      'app/user.py': 'def get_user(id): return db.query(User).filter(User.id == id).first()',
      'app/item.py': 'def get_item(id): return db.query(Item).filter(Item.id == id).first()',
      'app/auth.py': 'def login(username, password): pass',
    })

    const results = grepSearch(files, 'get user')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].filepath).toBe('app/user.py')
    expect(results[0].source).toBe('grep')
  })

  it('ranks files with more keyword matches higher', () => {
    const files = makeFiles({
      'app/a.py': 'authentication authentication authentication',
      'app/b.py': 'authentication',
    })

    const results = grepSearch(files, 'authentication')
    expect(results[0].filepath).toBe('app/a.py')
  })

  it('scores function name matches 3x higher than content occurrences', () => {
    // File A has the keyword once in content
    // File B has it as a function name (which is 3x bonus + 1x content)
    const files = makeFiles({
      'app/a.py': 'x = "payment"',
      'app/b.py': 'def payment(): pass',
    })

    const results = grepSearch(files, 'payment')
    expect(results[0].filepath).toBe('app/b.py')
  })

  it('gives 5 bonus for filename match', () => {
    const files = makeFiles({
      'app/auth.py': 'x = 1',
      'app/main.py': 'auth = None\nauth_check = True',
    })

    // 'auth' appears twice in main.py (score=2) but auth.py has filename match (+5 = 6)
    const results = grepSearch(files, 'auth')
    expect(results[0].filepath).toBe('app/auth.py')
  })

  it('respects the limit parameter', () => {
    const files = makeFiles({
      'a.py': 'foo bar',
      'b.py': 'foo bar',
      'c.py': 'foo bar',
      'd.py': 'foo bar',
      'e.py': 'foo bar',
      'f.py': 'foo bar',
    })

    const results = grepSearch(files, 'foo', 3)
    expect(results.length).toBeLessThanOrEqual(3)
  })

  it('returns source as grep', () => {
    const files = makeFiles({ 'x.py': 'def hello(): return "world"' })
    const results = grepSearch(files, 'hello')
    expect(results[0].source).toBe('grep')
  })

  it('extracts a snippet around the best matching line', () => {
    const lines = ['import os'] // filler
    for (let i = 0; i < 30; i++) lines.push(`line_${i} = ${i}`)
    lines.push('def target_function(): pass')
    for (let i = 0; i < 30; i++) lines.push(`other_${i} = ${i}`)

    const files = makeFiles({ 'app/x.py': lines.join('\n') })
    const results = grepSearch(files, 'target_function')
    expect(results[0].content).toContain('target_function')
    // Snippet should not be the entire file (±15 lines)
    expect(results[0].content.split('\n').length).toBeLessThanOrEqual(31)
  })

  it('handles empty files map', () => {
    expect(grepSearch(new Map(), 'query')).toEqual([])
  })

  it('returns results sorted by score descending', () => {
    const files = makeFiles({
      'a.py': 'cache cache cache cache',
      'b.py': 'cache cache',
      'c.py': 'cache cache cache',
    })

    const results = grepSearch(files, 'cache')
    const scores = results.map(r => r.score)
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1])
    }
  })

  it('filters stopwords from query', () => {
    const files = makeFiles({ 'x.py': 'the and or is to' })
    // All words are stopwords — should return no results
    const results = grepSearch(files, 'the and or is to')
    expect(results).toEqual([])
  })
})
