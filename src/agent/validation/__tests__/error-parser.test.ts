import { describe, expect, it } from 'vitest'

import {
  enrichErrorContext,
  parseCompileErrors,
  parsePyflakesErrors,
  parseRuntimeErrors
} from '../error-parser'

// ---------------------------------------------------------------------------
// parseCompileErrors
// ---------------------------------------------------------------------------

describe('parseCompileErrors', () => {
  it('parses standard SyntaxError output', () => {
    const output = `
  File "/tmp/foo.py", line 3
    def bad syntax():
         ^
SyntaxError: invalid syntax
`.trim()
    const errors = parseCompileErrors(output, 'foo.py')
    expect(errors).toHaveLength(1)
    expect(errors[0].line).toBe(3)
    expect(errors[0].code).toBe('E999')
    expect(errors[0].message).toBe('invalid syntax')
    expect(errors[0].severity).toBe('error')
    expect(errors[0].file).toBe('foo.py')
  })

  it('parses IndentationError output', () => {
    const output = `
  File "/tmp/bar.py", line 7
    return x
IndentationError: unexpected indent
`.trim()
    const errors = parseCompileErrors(output, 'bar.py')
    expect(errors[0].message).toContain('unexpected indent')
    expect(errors[0].line).toBe(7)
  })

  it('returns empty array for empty input', () => {
    expect(parseCompileErrors('')).toHaveLength(0)
    expect(parseCompileErrors('  \n  ')).toHaveLength(0)
  })

  it('extracts file from output when filePath not provided', () => {
    const output = `  File "/tmp/some/file.py", line 1\nSyntaxError: something`
    const errors = parseCompileErrors(output)
    expect(errors[0].file).toBe('/tmp/some/file.py')
  })
})

// ---------------------------------------------------------------------------
// parsePyflakesErrors
// ---------------------------------------------------------------------------

describe('parsePyflakesErrors', () => {
  it('parses pyflakes undefined name error', () => {
    const output = "models.py:10:1 undefined name 'User'"
    const errors = parsePyflakesErrors(output, 'models.py')
    expect(errors).toHaveLength(1)
    expect(errors[0].line).toBe(10)
    expect(errors[0].col).toBe(1)
    expect(errors[0].message).toContain("undefined name 'User'")
    expect(errors[0].severity).toBe('error')
  })

  it('marks imported but unused as warning', () => {
    const output = "routes.py:5:1 'os' imported but unused"
    const errors = parsePyflakesErrors(output, 'routes.py')
    expect(errors[0].severity).toBe('warning')
  })

  it('parses multiple errors', () => {
    const output = [
      "app.py:3:1 'sys' imported but unused",
      "app.py:8:1 undefined name 'db'"
    ].join('\n')
    const errors = parsePyflakesErrors(output, 'app.py')
    expect(errors).toHaveLength(2)
    expect(errors[1].severity).toBe('error')
  })

  it('returns empty array for empty input', () => {
    expect(parsePyflakesErrors('')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// parseRuntimeErrors
// ---------------------------------------------------------------------------

describe('parseRuntimeErrors', () => {
  it('parses Python traceback with ImportError', () => {
    const stderr = `
Traceback (most recent call last):
  File "/app/main.py", line 5, in <module>
    from app.models import User
ImportError: No module named 'app.models'
`.trim()
    const errors = parseRuntimeErrors(stderr)
    expect(errors).toHaveLength(1)
    expect(errors[0].code).toBe('ImportError')
    expect(errors[0].message).toContain("No module named 'app.models'")
    expect(errors[0].line).toBe(5)
    expect(errors[0].severity).toBe('error')
  })

  it('parses AttributeError in traceback', () => {
    const stderr = `
Traceback (most recent call last):
  File "/app/crud.py", line 12, in get_item
    return db.query(Item).filter(Item.idx == item_id).first()
AttributeError: 'NoneType' object has no attribute 'query'
`.trim()
    const errors = parseRuntimeErrors(stderr)
    expect(errors[0].code).toBe('AttributeError')
    expect(errors[0].line).toBe(12)
  })

  it('returns empty array for empty stderr', () => {
    expect(parseRuntimeErrors('')).toHaveLength(0)
  })

  it('captures ERROR: lines from uvicorn', () => {
    const stderr = `INFO:     Started server process [12345]\nERROR: Error loading ASGI app. Could not import module "app.main".`
    const errors = parseRuntimeErrors(stderr)
    expect(errors.some(e => e.message.includes('Error loading ASGI app'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// enrichErrorContext
// ---------------------------------------------------------------------------

describe('enrichErrorContext', () => {
  const fileContent = [
    'from fastapi import FastAPI',
    '',
    'app = FastAPI()',
    '',
    'def bad syntax():',  // line 5
    '    pass',
    ''
  ].join('\n')

  it('includes error message in header', () => {
    const error = { file: 'main.py', line: 5, message: 'invalid syntax', severity: 'error' as const }
    const ctx = enrichErrorContext(error, fileContent)
    expect(ctx).toContain('Error in main.py line 5')
    expect(ctx).toContain('invalid syntax')
  })

  it('includes surrounding lines', () => {
    const error = { file: 'main.py', line: 5, message: 'invalid syntax', severity: 'error' as const }
    const ctx = enrichErrorContext(error, fileContent)
    expect(ctx).toContain('LINE 5:')
    expect(ctx).toContain('← ERROR HERE')
    expect(ctx).toContain('LINE 3:')  // 2 lines before
    expect(ctx).toContain('LINE 6:')  // 1 line after
  })

  it('handles missing line gracefully', () => {
    const error = { file: 'main.py', message: 'some error', severity: 'error' as const }
    const ctx = enrichErrorContext(error, fileContent)
    expect(ctx).toContain('line ?')
    expect(ctx).not.toContain('LINE')
  })

  it('handles first line error without underflowing', () => {
    const error = { file: 'main.py', line: 1, message: 'bad import', severity: 'error' as const }
    const ctx = enrichErrorContext(error, fileContent)
    expect(ctx).toContain('LINE 1:')
    expect(ctx).toContain('← ERROR HERE')
  })
})
