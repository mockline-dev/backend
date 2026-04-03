import { exec, execFile } from 'child_process'
import { mkdir, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

import { logger } from '../../logger'
import type { VenvManager } from './venv-manager'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

export interface ValidationError {
  line?: number
  col?: number
  code?: string
  message: string
}

export interface PythonValidationResult {
  path: string
  valid: boolean
  errors: ValidationError[]
  /** Which validation tiers ran successfully */
  tiersRun: Array<'syntax' | 'pyflakes' | 'ruff' | 'venv-pyflakes'>
}

const TMP_DIR = join(tmpdir(), 'mockline-validation')

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Full validation pipeline for a Python file:
 *   Tier 1 — py_compile     (syntax, always available, ~0 ms)
 *   Tier 2 — ruff check     (fast linting, if installed, ~50 ms)
 *   Tier 3 — venv pyflakes  (import resolution, if venv is available, ~200 ms)
 *
 * Stops at the first tier that reports errors so the fix loop has a clear target.
 * Tier 3 only runs when `venv` and `projectId` are supplied.
 */
export async function validatePython(
  path: string,
  content: string,
  venv?: VenvManager,
  projectId?: string
): Promise<PythonValidationResult> {
  const tiersRun: PythonValidationResult['tiersRun'] = []

  // Tier 1 — syntax (py_compile) ─────────────────────────────────────────────
  const syntaxErrors = await runPyCompile(path, content)
  tiersRun.push('syntax')
  if (syntaxErrors.length > 0) {
    return { path, valid: false, errors: syntaxErrors, tiersRun }
  }

  // Tier 2 — ruff linting ────────────────────────────────────────────────────
  const ruffErrors = await runRuff(path, content)
  tiersRun.push('ruff')
  if (ruffErrors.length > 0) {
    return { path, valid: false, errors: ruffErrors, tiersRun }
  }

  // Tier 3 — venv pyflakes (import resolution) ───────────────────────────────
  if (venv && projectId && venv.has(projectId)) {
    const pyflakesErrors = await runVenvPyflakes(path, content, venv, projectId)
    tiersRun.push('venv-pyflakes')
    if (pyflakesErrors.length > 0) {
      return { path, valid: false, errors: pyflakesErrors, tiersRun }
    }
  }

  return { path, valid: true, errors: [], tiersRun }
}

// ---------------------------------------------------------------------------
// Tier 1 — py_compile (syntax only, no imports needed)
// ---------------------------------------------------------------------------

async function runPyCompile(path: string, content: string): Promise<ValidationError[]> {
  await mkdir(TMP_DIR, { recursive: true })
  const tmpFile = join(TMP_DIR, `syntax_${Date.now()}_${safeFilename(path)}`)

  try {
    await writeFile(tmpFile, content, 'utf8')
    await execFileAsync('python3', ['-m', 'py_compile', tmpFile], { timeout: 10_000 })
    return []
  } catch (err: unknown) {
    const stderr = extractStderr(err)
    if (!stderr) return []

    // Replace temp path with original path in error messages
    const cleaned = stderr.replace(new RegExp(tmpFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), path)

    // Parse "File X, line N\n  SyntaxError: msg" format
    const errors: ValidationError[] = []
    const lineMatch = cleaned.match(/line (\d+)/)
    const msgMatch = cleaned.match(/(?:SyntaxError|IndentationError|TabError): (.+)/)
    errors.push({
      line: lineMatch ? parseInt(lineMatch[1], 10) : undefined,
      code: 'E999',
      message: msgMatch ? msgMatch[1].trim() : cleaned.trim().split('\n').pop() ?? 'Syntax error'
    })
    return errors
  } finally {
    await unlink(tmpFile).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Tier 2 — ruff (linting, catches style + common runtime errors)
// ---------------------------------------------------------------------------

async function runRuff(path: string, content: string): Promise<ValidationError[]> {
  await mkdir(TMP_DIR, { recursive: true })
  const tmpFile = join(TMP_DIR, `ruff_${Date.now()}_${safeFilename(path)}`)

  try {
    await writeFile(tmpFile, content, 'utf8')

    // Only report errors that will actually break execution:
    //   E9   — syntax / runtime errors
    //   F821 — undefined name (NameError at runtime)
    //   F811 — redefinition of unused import (can mask real names)
    //   F9   — assert / raise errors
    //   E711 — comparison to None using == (use 'is None' instead)
    //   W605 — invalid escape sequence (runtime DeprecationWarning → error in future Python)
    // Excluded: F401 (unused imports) and F841 (unused vars) — these are style, not runtime errors
    const { stderr } = await execAsync(
      `ruff check --quiet --select=E9,F821,F811,F9,E711,W605 --output-format=json "${tmpFile}"`,
      { timeout: 10_000 }
    )
    if (stderr) logger.debug('ruff stderr for %s: %s', path, stderr.slice(0, 200))
    return []
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'stdout' in err) {
      const raw = (err as { stdout?: string }).stdout
      if (!raw) return []
      try {
        const results = JSON.parse(raw) as Array<{
          location?: { row?: number; column?: number }
          code?: string
          message?: string
        }>
        return results.map(r => ({
          line: r.location?.row,
          col: r.location?.column,
          code: r.code,
          message: r.message ?? 'ruff error'
        }))
      } catch {
        logger.debug('ruff output parse failed for %s', path)
        return []
      }
    }
    // ruff not installed — non-fatal
    logger.debug('ruff unavailable for %s', path)
    return []
  } finally {
    await unlink(tmpFile).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Tier 3 — pyflakes inside project venv (undefined names + missing imports)
// ---------------------------------------------------------------------------

async function runVenvPyflakes(
  path: string,
  content: string,
  venv: VenvManager,
  projectId: string
): Promise<ValidationError[]> {
  await mkdir(TMP_DIR, { recursive: true })
  const tmpFile = join(TMP_DIR, `pyflakes_${Date.now()}_${safeFilename(path)}`)

  try {
    await writeFile(tmpFile, content, 'utf8')
    const result = await venv.run(projectId, ['-m', 'pyflakes', tmpFile])

    if (result.exitCode === 0 && !result.stderr) return []

    const output = result.stdout + result.stderr
    return parseFlakesOutput(output, tmpFile, path)
  } catch (err: unknown) {
    logger.debug('VenvManager: pyflakes unavailable for %s: %s', path, String(err))
    return []
  } finally {
    await unlink(tmpFile).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseFlakesOutput(output: string, tmpFile: string, originalPath: string): ValidationError[] {
  const errors: ValidationError[] = []
  const lines = output.split('\n').filter(l => l.trim())

  for (const line of lines) {
    // Format: "/tmp/file.py:10:1 F821 undefined name 'foo'"
    const match = line.match(/^.+?:(\d+)(?::(\d+))?\s+(.+)$/)
    if (match) {
      errors.push({
        line: parseInt(match[1], 10),
        col: match[2] ? parseInt(match[2], 10) : undefined,
        message: match[3].replace(tmpFile, originalPath).trim()
      })
    }
  }

  return errors
}

function safeFilename(path: string): string {
  return path.replace(/[^\w.-]/g, '_').slice(-40)
}

function extractStderr(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    const v = (err as { stderr?: string | Buffer }).stderr
    return v ? String(v) : ''
  }
  return ''
}
