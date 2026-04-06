import { describe, it, expect } from 'vitest'
import { chunkText } from '../text.chunker'

const SAMPLE_CODE = Array.from({ length: 80 }, (_, i) => `line ${i + 1}: some content here`).join('\n')

describe('chunkText', () => {
  it('returns at least one chunk for non-empty content', () => {
    const chunks = chunkText('Hello\nWorld\n', 'test.txt')
    expect(chunks.length).toBeGreaterThan(0)
  })

  it('returns empty array for empty content', () => {
    const chunks = chunkText('', 'empty.txt')
    expect(chunks).toHaveLength(0)
  })

  it('each chunk has required fields', () => {
    const chunks = chunkText(SAMPLE_CODE, 'src/example.py')
    for (const chunk of chunks) {
      expect(chunk.id).toBeTruthy()
      expect(chunk.filepath).toBe('src/example.py')
      expect(typeof chunk.content).toBe('string')
      expect(chunk.content.length).toBeGreaterThan(0)
      expect(typeof chunk.startLine).toBe('number')
      expect(typeof chunk.endLine).toBe('number')
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine)
    }
  })

  it('chunk IDs are unique', () => {
    const chunks = chunkText(SAMPLE_CODE, 'test.ts')
    const ids = chunks.map(c => c.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('produces multiple chunks for large content', () => {
    const chunks = chunkText(SAMPLE_CODE, 'big.py', 50)
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('respects maxTokens — no chunk exceeds limit by much', () => {
    const chunks = chunkText(SAMPLE_CODE, 'test.py', 30)
    // Each chunk should be reasonably close to the limit
    for (const chunk of chunks) {
      const lines = chunk.content.split('\n').length
      expect(lines).toBeLessThan(60) // rough sanity check
    }
  })

  it('chunk content covers the whole file approximately', () => {
    const lines = SAMPLE_CODE.split('\n')
    const chunks = chunkText(SAMPLE_CODE, 'test.py', 200)
    // All lines should appear somewhere in the chunks (may overlap)
    const allContent = chunks.map(c => c.content).join('\n')
    // First and last lines should be present
    expect(allContent).toContain(lines[0])
    expect(allContent).toContain(lines[lines.length - 1])
  })

  it('uses filename as symbolName', () => {
    const chunks = chunkText('some content', 'myfile.md')
    expect(chunks[0].symbolName).toBe('myfile.md')
  })
})
