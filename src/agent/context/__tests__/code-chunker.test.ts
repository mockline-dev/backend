import { describe, it, expect } from 'vitest'
import { chunkPythonFile, chunkFile } from '../code-chunker'

// ─── Helper ───────────────────────────────────────────────────────────────────

const fp = 'app/test.py'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('chunkPythonFile', () => {
  it('returns empty array for empty file', () => {
    expect(chunkPythonFile(fp, '')).toEqual([])
    expect(chunkPythonFile(fp, '   \n\n')).toEqual([])
  })

  it('produces one imports chunk for an imports-only file', () => {
    const content = `import os\nfrom typing import List\nimport sys`
    const chunks = chunkPythonFile(fp, content)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].type).toBe('imports')
    expect(chunks[0].name).toBe('imports')
    expect(chunks[0].content).toContain('import os')
    expect(chunks[0].content).toContain('from typing import List')
    expect(chunks[0].startLine).toBe(1)
  })

  it('produces imports + function chunks for a typical file', () => {
    const content = [
      'import os',
      'from typing import List',
      '',
      'def foo(value: int) -> int:',
      '    return value * 2',
      '',
      'def bar(x: int, y: int) -> str:',
      '    return str(x + y)',
      '',
      'async def baz(name: str) -> None:',
      '    await something(name)',
    ].join('\n')

    const chunks = chunkPythonFile(fp, content)
    const types = chunks.map(c => c.type)
    expect(types).toContain('imports')
    expect(types.filter(t => t === 'function')).toHaveLength(3)

    const names = chunks.map(c => c.name)
    expect(names).toContain('foo')
    expect(names).toContain('bar')
    expect(names).toContain('baz')
  })

  it('produces a class chunk for a class definition', () => {
    const content = [
      'class MyClass:',
      '    def __init__(self):',
      '        self.x = 0',
      '',
      '    def method(self):',
      '        return self.x',
    ].join('\n')

    const chunks = chunkPythonFile(fp, content)
    const classChunk = chunks.find(c => c.type === 'class')
    expect(classChunk).toBeDefined()
    expect(classChunk?.name).toBe('MyClass')
  })

  it('includes decorators with their function', () => {
    const content = [
      '@router.get("/items")',
      'def get_items():',
      '    return []',
    ].join('\n')

    const chunks = chunkPythonFile(fp, content)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].type).toBe('function')
    expect(chunks[0].name).toBe('get_items')
    expect(chunks[0].content).toContain('@router.get')
    expect(chunks[0].startLine).toBe(1)
  })

  it('includes docstrings with their function', () => {
    const content = [
      'def documented():',
      '    """This is a docstring."""',
      '    pass',
    ].join('\n')

    const chunks = chunkPythonFile(fp, content)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].content).toContain('docstring')
  })

  it('sets correct metadata (filepath, startLine, endLine, name, type)', () => {
    const content = [
      'import os',
      '',
      'def alpha():',
      '    pass',
    ].join('\n')

    const chunks = chunkPythonFile(fp, content)
    for (const chunk of chunks) {
      expect(chunk.filepath).toBe(fp)
      expect(typeof chunk.startLine).toBe('number')
      expect(typeof chunk.endLine).toBe('number')
      expect(chunk.startLine).toBeGreaterThanOrEqual(1)
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine)
      expect(chunk.metadata.filepath).toBe(fp)
      expect(chunk.metadata.startLine).toBe(chunk.startLine)
      expect(chunk.metadata.endLine).toBe(chunk.endLine)
    }
  })

  it('splits a large class into per-method chunks', () => {
    const methodBody = '    ' + 'x = 1\n'.repeat(200)
    const content = [
      'class BigClass:',
      '    def method_a(self):',
      methodBody,
      '    def method_b(self):',
      methodBody,
    ].join('\n')

    const chunks = chunkPythonFile(fp, content, 100)
    const names = chunks.map(c => c.name)
    expect(names).toContain('method_a')
    expect(names).toContain('method_b')
  })

  it('generates unique ids for chunks', () => {
    const content = [
      'import os',
      '',
      'def foo():',
      '    pass',
      '',
      'def bar():',
      '    pass',
    ].join('\n')

    const chunks = chunkPythonFile(fp, content)
    const ids = chunks.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('chunkFile', () => {
  it('delegates .py files to chunkPythonFile', () => {
    const content = 'import os\n\ndef foo(value: int) -> int:\n    return value * 2'
    const chunks = chunkFile('main.py', content)
    expect(chunks.some(c => c.type === 'function')).toBe(true)
  })

  it('splits non-py files by double newlines', () => {
    const content = 'section one\nline two\n\nsection two\nline four'
    const chunks = chunkFile('README.md', content)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks[0].type).toBe('module-level')
  })

  it('filters out chunks shorter than 20 chars', () => {
    const content = 'hi\n\nthis is a longer section with enough content to pass the filter'
    const chunks = chunkFile('notes.txt', content)
    expect(chunks.every(c => c.content.trim().length >= 20)).toBe(true)
  })
})
