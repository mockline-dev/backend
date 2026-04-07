import { describe, it, expect } from 'vitest'
import { extractCodeBlocks, detectPrimaryLanguage } from '../code-extractor'

describe('extractCodeBlocks', () => {
  it('returns empty array for text with no code blocks', () => {
    expect(extractCodeBlocks('Just some plain text.')).toEqual([])
  })

  it('extracts a single block without a filepath', () => {
    const md = '```ts\nconst x = 1\n```'
    const files = extractCodeBlocks(md)
    expect(files).toHaveLength(1)
    expect(files[0].language).toBe('ts')
    expect(files[0].content).toContain('const x = 1')
  })

  it('extracts filepath from fence line with // filepath:', () => {
    const md = '```ts // filepath: src/index.ts\nconst x = 1\n```'
    const files = extractCodeBlocks(md)
    expect(files[0].path).toBe('src/index.ts')
  })

  it('extracts filepath from fence line (bare path)', () => {
    const md = '```typescript // src/app.ts\nconst y = 2\n```'
    const files = extractCodeBlocks(md)
    expect(files[0].path).toBe('src/app.ts')
  })

  it('extracts filepath from first-line C-style comment', () => {
    const md = '```ts\n// src/utils.ts\nexport const foo = () => {}\n```'
    const files = extractCodeBlocks(md)
    expect(files[0].path).toBe('src/utils.ts')
  })

  it('extracts filepath from first-line Python comment', () => {
    const md = '```python\n# src/main.py\nprint("hello")\n```'
    const files = extractCodeBlocks(md)
    expect(files[0].path).toBe('src/main.py')
  })

  it('generates fallback filename when no path found', () => {
    const md = '```typescript\nconst z = 3\n```'
    const files = extractCodeBlocks(md)
    // Should either infer a name or fall back to file_N.ts
    expect(files[0].path).toMatch(/\.(ts|js)$/)
  })

  it('extracts multiple code blocks', () => {
    const md = [
      '```ts // filepath: src/a.ts\nexport const a = 1\n```',
      '',
      '```ts // filepath: src/b.ts\nexport const b = 2\n```'
    ].join('\n')
    const files = extractCodeBlocks(md)
    expect(files).toHaveLength(2)
    expect(files.map(f => f.path)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('skips empty code blocks', () => {
    const md = '```ts\n```'
    expect(extractCodeBlocks(md)).toHaveLength(0)
  })

  it('infers main.py for Python block with if __name__', () => {
    const md = '```python\nif __name__ == "__main__":\n    print("hello")\n```'
    const files = extractCodeBlocks(md)
    expect(files[0].path).toBe('main.py')
  })

  it('infers main.py for FastAPI entry point', () => {
    const md = '```python\nfrom fastapi import FastAPI\napp = FastAPI()\n```'
    const files = extractCodeBlocks(md)
    expect(files[0].path).toBe('main.py')
  })

  it('infers script.sh for shell scripts with shebang', () => {
    const md = '```sh\n#!/bin/bash\necho "hello"\n```'
    const files = extractCodeBlocks(md)
    expect(files[0].path).toBe('script.sh')
  })

  it('infers Dockerfile for Dockerfile content', () => {
    const md = '```\nFROM python:3.11-slim\nRUN pip install fastapi\n```'
    const files = extractCodeBlocks(md)
    expect(files[0].path).toBe('Dockerfile')
  })

  it('disambiguates collisions when two blocks infer the same name', () => {
    const md = [
      '```python\nif __name__ == "__main__":\n    pass\n```',
      '',
      '```python\nif __name__ == "__main__":\n    print("second")\n```'
    ].join('\n')
    const files = extractCodeBlocks(md)
    expect(files).toHaveLength(2)
    expect(files[0].path).toBe('main.py')
    expect(files[1].path).toBe('main_2.py')
  })
})

describe('detectPrimaryLanguage', () => {
  it('returns typescript for ts files', () => {
    const files = [
      { path: 'a.ts', content: '', language: 'typescript' },
      { path: 'b.ts', content: '', language: 'typescript' }
    ]
    expect(detectPrimaryLanguage(files)).toBe('typescript')
  })

  it('returns the most common language', () => {
    const files = [
      { path: 'a.py', content: '', language: 'python' },
      { path: 'b.py', content: '', language: 'python' },
      { path: 'c.ts', content: '', language: 'typescript' }
    ]
    expect(detectPrimaryLanguage(files)).toBe('python')
  })

  it('defaults to typescript for empty input', () => {
    expect(detectPrimaryLanguage([])).toBe('typescript')
  })
})
