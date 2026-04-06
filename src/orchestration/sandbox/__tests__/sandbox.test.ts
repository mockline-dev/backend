import { describe, it, expect, vi } from 'vitest'
import { runSandbox, buildFixPrompt } from '../sandbox'
import type { ISandboxProvider } from '../providers/provider.interface'
import type { SandboxFile, SandboxResult } from '../types'

const mockSuccessResult: SandboxResult = {
  success: true,
  files: [],
  syntaxValid: true,
  compilationOutput: 'OK',
  testOutput: null,
  stdout: '',
  stderr: '',
  durationMs: 100
}

const mockFailResult: SandboxResult = {
  success: false,
  files: [],
  syntaxValid: false,
  compilationOutput: 'error TS2304: Cannot find name',
  testOutput: null,
  stdout: '',
  stderr: 'Type error',
  durationMs: 50
}

function makeProvider(result: SandboxResult): ISandboxProvider {
  return {
    name: 'mock',
    execute: vi.fn().mockResolvedValue(result)
  }
}

describe('runSandbox', () => {
  const emit = vi.fn()
  const projectId = 'proj-test'

  it('returns empty no-op result when there are no code blocks', async () => {
    const provider = makeProvider(mockSuccessResult)
    const { result } = await runSandbox('No code here.', provider, emit, projectId)
    expect(result.success).toBe(true)
    expect(result.files).toHaveLength(0)
    expect(provider.execute).not.toHaveBeenCalled()
  })

  it('calls provider.execute with extracted files', async () => {
    const provider = makeProvider(mockSuccessResult)
    const md = '```ts // filepath: src/a.ts\nexport const x = 1\n```'
    await runSandbox(md, provider, emit, projectId)
    expect(provider.execute).toHaveBeenCalledOnce()
    const [files] = (provider.execute as any).mock.calls[0]
    expect(files[0].path).toBe('src/a.ts')
  })

  it('emits sandbox:started event', async () => {
    const provider = makeProvider(mockSuccessResult)
    const md = '```ts // filepath: src/a.ts\nconst x = 1\n```'
    await runSandbox(md, provider, emit, projectId)
    expect(emit).toHaveBeenCalledWith('sandbox:started', projectId, expect.objectContaining({ fileCount: 1 }))
  })

  it('returns failed result when provider reports failure', async () => {
    const provider = makeProvider(mockFailResult)
    const md = '```ts // filepath: src/a.ts\nconst x = 1\n```'
    const { result } = await runSandbox(md, provider, emit, projectId)
    expect(result.success).toBe(false)
    expect(result.compilationOutput).toContain('error TS2304')
  })

  it('handles provider throwing exception gracefully', async () => {
    const provider: ISandboxProvider = {
      name: 'throwing',
      execute: vi.fn().mockRejectedValue(new Error('Connection refused'))
    }
    const md = '```ts // filepath: src/a.ts\nconst x = 1\n```'
    const { result } = await runSandbox(md, provider, emit, projectId)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Connection refused')
    expect(emit).toHaveBeenCalledWith('sandbox:error', projectId, expect.any(Object))
  })
})

describe('buildFixPrompt', () => {
  it('includes error details in the prompt', () => {
    const prompt = buildFixPrompt('const x = ???', {
      ...mockFailResult,
      compilationOutput: 'SyntaxError: Unexpected token'
    })
    expect(prompt).toContain('SyntaxError: Unexpected token')
    expect(prompt).toContain('const x = ???')
  })

  it('includes fix instruction', () => {
    const prompt = buildFixPrompt('code', mockFailResult)
    expect(prompt).toContain('fix')
  })
})
