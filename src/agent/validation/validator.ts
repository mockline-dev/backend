import type { Application } from '../../declarations'
import { logger } from '../../logger'
import type { GeneratedFile } from '../pipeline/file-generator'
import { runFixLoop, type FixTarget } from './fix-loop'
import { validatePython } from './python-validator'
import { validateTypeScript } from './ts-validator'
import type { VenvManager } from './venv-manager'

export interface FileValidationResult {
  path: string
  valid: boolean
  errors: Array<{ line?: number; code?: string; message: string }>
  /** True when the file was fixed by the fix loop */
  wasFixed?: boolean
}

export interface ValidationSummary {
  passCount: number
  failCount: number
  results: FileValidationResult[]
  fixedCount: number
}

/**
 * Validates all generated files, then runs the AI fix loop for any failures.
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
  const failTargets: FixTarget[] = []

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
      failTargets.push({ file, errors: result.errors })
      const errorSummary = result.errors
        .slice(0, 5)
        .map(e => `L${e.line ?? '?'}${e.code ? `[${e.code}]` : ''}: ${e.message}`)
        .join(' | ')
      logger.warn(
        'Validator: %s has %d error(s) — queued for fix loop: %s',
        file.path,
        result.errors.length,
        errorSummary
      )
    }

    results.push(result)
  }

  if (failTargets.length === 0) {
    return buildSummary(results, 0)
  }

  // ── Phase 2: AI fix loop ─────────────────────────────────────────────────
  logger.info(
    'Validator: running fix loop for %d failed file(s) (project %s)',
    failTargets.length,
    projectId
  )
  await onProgress('Running AI fix loop', 95)

  const { fixed } = await runFixLoop(failTargets, {
    validate: async (path, content) => {
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
    },
    maxAttempts: 3
  })

  // Apply fixes into the in-memory files array and update results
  for (const fix of fixed) {
    const file = files.find(f => f.path === fix.path)
    if (file) file.content = fix.content

    const idx = results.findIndex(r => r.path === fix.path)
    if (idx >= 0) {
      results[idx] = { path: fix.path, valid: true, errors: [], wasFixed: true }
    }

    logger.info('Validator: fixed %s after %d attempt(s)', fix.path, fix.attempts)
  }

  return buildSummary(results, fixed.length)
}

function buildSummary(results: FileValidationResult[], fixedCount: number): ValidationSummary {
  const failCount = results.filter(r => !r.valid).length
  return {
    passCount: results.length - failCount,
    failCount,
    results,
    fixedCount
  }
}
