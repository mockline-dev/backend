import { describe, expect, it } from 'vitest'

import { validatePython } from '../python-validator'

// These tests validate in-memory Python content without needing a venv.
// Tier-1 (py_compile) and Tier-2 (ruff) run via system Python/ruff.

describe('validatePython', () => {
  it('returns valid for a simple correct Python file', async () => {
    const content = `
def hello(name: str) -> str:
    return f"Hello, {name}!"
`.trim()
    const result = await validatePython('hello.py', content)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.tiersRun).toContain('syntax')
  })

  it('catches SyntaxError in tier-1', async () => {
    const content = `
def bad syntax():
    pass
`.trim()
    const result = await validatePython('bad.py', content)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.tiersRun).toContain('syntax')
    // Should not run ruff if syntax failed
    expect(result.tiersRun).not.toContain('ruff')
  })

  it('catches IndentationError in tier-1', async () => {
    const content = `
def foo():
pass
`.trim()
    const result = await validatePython('indent.py', content)
    expect(result.valid).toBe(false)
    expect(result.errors[0].message).toMatch(/indent/i)
  })

  it('returns valid path in result', async () => {
    const result = await validatePython('src/models.py', 'x = 1\n')
    expect(result.path).toBe('src/models.py')
  })

  it('handles empty file', async () => {
    const result = await validatePython('empty.py', '')
    expect(result.valid).toBe(true)
  })

  it('minimal FastAPI app passes syntax check', async () => {
    const content = `
from fastapi import FastAPI

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok"}
`.trim()
    const result = await validatePython('main.py', content)
    expect(result.valid).toBe(true)
  })
})
