import { rm } from 'fs/promises'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { VenvManager } from '../venv-manager'

const TEST_BASE = '/tmp/mockline-test-venvs'
const TEST_PROJECT = `venv-test-${Date.now()}`

// These tests create real venvs — they need Python 3 in PATH
// Skip gracefully if Python is unavailable

describe('VenvManager', () => {
  let manager: VenvManager

  beforeEach(() => {
    manager = new VenvManager()
  })

  afterEach(async () => {
    // Clean up any test venv
    await rm(join(TEST_BASE, TEST_PROJECT), { recursive: true, force: true }).catch(() => {})
    await rm(join(TEST_BASE, `${TEST_PROJECT}-req.txt`), { force: true }).catch(() => {})
  })

  it('has() returns false for unknown project', () => {
    expect(manager.has('does-not-exist')).toBe(false)
  })

  it('getOrCreate creates a venv and returns python path', async () => {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const execFileAsync = promisify(execFile)

    // Check python3 is available
    try {
      await execFileAsync('python3', ['--version'], { timeout: 5_000 })
    } catch {
      console.warn('Skipping venv integration test: python3 not available')
      return
    }

    const pythonBin = await manager.getOrCreate(TEST_PROJECT, '# no packages\n')
    expect(pythonBin).toContain(TEST_PROJECT)
    expect(pythonBin).toContain('python3')
    expect(manager.has(TEST_PROJECT)).toBe(true)

    // Python binary should be executable
    const { stdout } = await execFileAsync(pythonBin, ['--version'], { timeout: 5_000 })
    expect(stdout + '').toMatch(/Python 3/)
  }, 60_000)

  it('getOrCreate is idempotent (second call returns cached)', async () => {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    try {
      await promisify(execFile)('python3', ['--version'], { timeout: 5_000 })
    } catch {
      return
    }

    const p1 = await manager.getOrCreate(TEST_PROJECT, '')
    const p2 = await manager.getOrCreate(TEST_PROJECT, '')
    expect(p1).toBe(p2)
  }, 60_000)

  it('cleanup removes venv and cache entry', async () => {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    try {
      await promisify(execFile)('python3', ['--version'], { timeout: 5_000 })
    } catch {
      return
    }

    await manager.getOrCreate(TEST_PROJECT, '')
    expect(manager.has(TEST_PROJECT)).toBe(true)
    await manager.cleanup(TEST_PROJECT)
    expect(manager.has(TEST_PROJECT)).toBe(false)
  }, 60_000)

  it('run executes python in the venv', async () => {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    try {
      await promisify(execFile)('python3', ['--version'], { timeout: 5_000 })
    } catch {
      return
    }

    await manager.getOrCreate(TEST_PROJECT, '')
    const result = await manager.run(TEST_PROJECT, ['-c', 'print("hello")'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello')
  }, 60_000)
})
