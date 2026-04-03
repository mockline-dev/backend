import { describe, expect, it, vi, beforeEach } from 'vitest'

import { createToolExecutor } from '../tool-executor'

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock the entire tool executor module so we can control individual tool results
vi.mock('../../tools/executor', () => ({
  executeToolCall: vi.fn()
}))

import { executeToolCall } from '../../tools/executor'
const mockExecuteToolCall = vi.mocked(executeToolCall)

// Minimal Application mock — services never called directly by createToolExecutor
const mockApp = {} as never

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCall(name: string, args: Record<string, unknown> = {}) {
  return { name, arguments: args }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createToolExecutor', () => {
  const projectId = 'test-project'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a function', () => {
    const executor = createToolExecutor(projectId, mockApp)
    expect(typeof executor).toBe('function')
  })

  it('list_files: returns formatted file list', async () => {
    mockExecuteToolCall.mockResolvedValueOnce({
      success: true,
      data: { files: ['main.py', 'app/models.py', 'requirements.txt'] }
    })

    const executor = createToolExecutor(projectId, mockApp)
    const result = await executor(makeCall('list_files', { directory: '' }))

    expect(result.success).toBe(true)
    expect(result.name).toBe('list_files')
    expect(result.result).toContain('main.py')
    expect(mockExecuteToolCall).toHaveBeenCalledWith('list_files', { directory: '' }, projectId, mockApp)
  })

  it('read_file: returns file content serialised as JSON', async () => {
    const fileContent = 'def hello():\n    return "hi"\n'
    mockExecuteToolCall.mockResolvedValueOnce({
      success: true,
      data: { path: 'main.py', content: fileContent }
    })

    const executor = createToolExecutor(projectId, mockApp)
    const result = await executor(makeCall('read_file', { path: 'main.py' }))

    expect(result.success).toBe(true)
    // result is JSON.stringified, so we parse it back to verify content
    const parsed = JSON.parse(result.result) as { path: string; content: string }
    expect(parsed.content).toBe(fileContent)
  })

  it('edit_file: succeeds when search text is found', async () => {
    mockExecuteToolCall.mockResolvedValueOnce({
      success: true,
      data: { path: 'main.py', changed: true }
    })

    const executor = createToolExecutor(projectId, mockApp)
    const result = await executor(
      makeCall('edit_file', { path: 'main.py', search: 'old text', replace: 'new text' })
    )

    expect(result.success).toBe(true)
    expect(mockExecuteToolCall).toHaveBeenCalledWith(
      'edit_file',
      { path: 'main.py', search: 'old text', replace: 'new text' },
      projectId,
      mockApp
    )
  })

  it('edit_file: returns error when search text not found', async () => {
    mockExecuteToolCall.mockResolvedValueOnce({
      success: false,
      error: 'Search text not found in main.py. Verify the exact text including whitespace.'
    })

    const executor = createToolExecutor(projectId, mockApp)
    const result = await executor(
      makeCall('edit_file', { path: 'main.py', search: 'not-there', replace: 'x' })
    )

    expect(result.success).toBe(false)
    expect(result.result).toContain('not found')
  })

  it('create_file: validates Python syntax before saving', async () => {
    mockExecuteToolCall.mockResolvedValueOnce({
      success: false,
      error: 'Syntax error: SyntaxError: invalid syntax'
    })

    const executor = createToolExecutor(projectId, mockApp)
    const result = await executor(
      makeCall('create_file', { path: 'bad.py', content: 'def foo(\n  # unterminated' })
    )

    expect(result.success).toBe(false)
    expect(result.result).toContain('Syntax error')
  })

  it('propagates tool name into ToolResult', async () => {
    mockExecuteToolCall.mockResolvedValueOnce({ success: true, data: { deleted: 'old.py' } })

    const executor = createToolExecutor(projectId, mockApp)
    const result = await executor(makeCall('delete_file', { path: 'old.py' }))

    expect(result.name).toBe('delete_file')
  })

  it('handles executor thrown errors gracefully', async () => {
    mockExecuteToolCall.mockRejectedValueOnce(new Error('R2 connection failed'))

    const executor = createToolExecutor(projectId, mockApp)
    await expect(executor(makeCall('read_file', { path: 'x.py' }))).rejects.toThrow(
      'R2 connection failed'
    )
  })
})
