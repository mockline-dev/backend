import type { Application } from '../../declarations'
import { logger } from '../../logger'
import { fixFileDeterministic } from './deterministic-fixer'
import { validatePython } from './python-validator'
import { validateTypeScript } from './ts-validator'
import type { VenvManager } from './venv-manager'

/** Minimal file descriptor needed by the validator (path + mutable content). */
export interface GeneratedFile {
  path: string
  content: string
}

export interface FileValidationResult {
  path: string
  valid: boolean
  errors: Array<{ line?: number; code?: string; message: string }>
  /** True when the file was fixed by the deterministic fixer */
  wasFixed?: boolean
  /** Strategy applied when the file was fixed */
  fixStrategy?: 'auto-fixed' | 'stubbed' | 'unchanged'
}

export interface ValidationSummary {
  passCount: number
  /** Number of files that failed py_compile (syntax errors) — NOT ruff/pyflakes warnings */
  failCount: number
  results: FileValidationResult[]
  fixedCount: number
  stubbedCount: number
  warnings: string[]
}

/**
 * Validates all generated files, then applies deterministic fixes (no LLM calls).
 *
 * Phase 1: Validate all files
 * Phase 2: For each failing file → apply deterministic fix (ruff auto-fix or stub)
 * Phase 3: Re-validate fixed files; remaining ruff/pyflakes warnings are accepted
 *
 * @param files        Files to validate (path + content in-memory).
 * @param projectId    Used for venv-based import validation.
 * @param _app         Reserved for future service lookups.
 * @param onProgress   Progress callback.
 * @param venv         Optional VenvManager. When provided, tier-3 (venv pyflakes) runs.
 */
export async function validateGeneratedFiles(
  files: GeneratedFile[],
  projectId: string,
  _app: Application,
  onProgress: (stage: string, pct: number) => Promise<void>,
  venv?: VenvManager
): Promise<ValidationSummary> {
  // ── Phase 1: validate all files ──────────────────────────────────────────
  const results: FileValidationResult[] = []
  const failTargets: Array<{ index: number; file: GeneratedFile; errors: Array<{ line?: number; code?: string; message: string }> }> = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const ext = file.path.split('.').pop()?.toLowerCase() ?? ''
    await onProgress(`Validating ${file.path}`, 90 + Math.round((i / files.length) * 5))

    let result: FileValidationResult

    if (ext === 'py') {
      const r = await validatePython(file.path, file.content, venv, projectId)
      result = { path: r.path, valid: r.valid, errors: r.errors }
    } else if (ext === 'ts' || ext === 'tsx') {
      const r = await validateTypeScript(file.path, file.content)
      result = { path: r.path, valid: r.valid, errors: r.errors }
    } else {
      result = { path: file.path, valid: true, errors: [] }
    }

    if (!result.valid && result.errors.length > 0) {
      // Only queue for fixing if there are syntax errors (py_compile failures, E999)
      const syntaxErrors = result.errors.filter(e => e.code === 'E999')
      if (syntaxErrors.length > 0 || ext !== 'py') {
        failTargets.push({ index: i, file, errors: result.errors })
      }
      const errorSummary = result.errors
        .slice(0, 5)
        .map(e => `L${e.line ?? '?'}${e.code ? `[${e.code}]` : ''}: ${e.message}`)
        .join(' | ')
      logger.warn(
        'Validator: %s has %d error(s) — queued for deterministic fix: %s',
        file.path,
        result.errors.length,
        errorSummary
      )
    }

    results.push(result)
  }

  if (failTargets.length === 0) {
    return buildSummary(results, [], 0)
  }

  // ── Phase 2: deterministic fix ────────────────────────────────────────────
  logger.info(
    'Validator: running deterministic fix for %d failed file(s) (project %s)',
    failTargets.length,
    projectId
  )
  await onProgress('Running deterministic fix', 95)

  const revalidate = async (path: string, content: string): Promise<Array<{ line?: number; code?: string; message: string }>> => {
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'py') {
      const r = await validatePython(path, content, venv, projectId)
      return r.errors
    }
    if (ext === 'ts' || ext === 'tsx') {
      const r = await validateTypeScript(path, content)
      return r.errors
    }
    return []
  }

  const allWarnings: string[] = []

  for (const target of failTargets) {
    const { index, file } = target
    const fixResult = await fixFileDeterministic(file.path, file.content, target.errors, revalidate)

    // Update in-memory file content
    files[index].content = fixResult.content

    // Update results
    const resultIdx = results.findIndex(r => r.path === file.path)
    if (resultIdx >= 0) {
      results[resultIdx] = {
        path: file.path,
        valid: true,
        errors: [],
        wasFixed: fixResult.strategy !== 'unchanged',
        fixStrategy: fixResult.strategy
      }
    }

    allWarnings.push(...fixResult.warnings)

    logger.info(
      'Validator: %s fixed via strategy=%s, fixes=[%s]',
      file.path,
      fixResult.strategy,
      fixResult.fixes.join(', ')
    )
  }

  // ── Phase 3: re-validate; accept remaining warnings ───────────────────────
  await onProgress('Accepting remaining warnings', 98)

  for (const target of failTargets) {
    const { index, file } = target
    const ext = file.path.split('.').pop()?.toLowerCase() ?? ''
    if (ext !== 'py') continue

    const remaining = await revalidate(file.path, files[index].content)
    const syntaxErrors = remaining.filter(e => e.code === 'E999')

    if (syntaxErrors.length > 0) {
      // Still has syntax errors — mark as failed (should not happen after stubbing)
      const resultIdx = results.findIndex(r => r.path === file.path)
      if (resultIdx >= 0) {
        results[resultIdx] = {
          path: file.path,
          valid: false,
          errors: syntaxErrors,
          wasFixed: false
        }
      }
      logger.warn('Validator: %s still has syntax errors after fix — accepting as-is', file.path)
    } else if (remaining.length > 0) {
      // Only warnings — accept them
      for (const e of remaining) {
        allWarnings.push(`${file.path}:${e.line ?? '?'} [${e.code ?? 'W'}]: ${e.message}`)
      }
    }
  }

  const fixedCount = results.filter(r => r.wasFixed && r.fixStrategy !== 'stubbed').length
  return buildSummary(results, allWarnings, fixedCount)
}

function buildSummary(
  results: FileValidationResult[],
  warnings: string[],
  fixedCount: number
): ValidationSummary {
  // failCount only counts py_compile (syntax) failures — not ruff/pyflakes warnings
  const failCount = results.filter(r => !r.valid).length
  const stubbedCount = results.filter(r => r.fixStrategy === 'stubbed').length

  return {
    passCount: results.length - failCount,
    failCount,
    results,
    fixedCount,
    stubbedCount,
    warnings
  }
}
