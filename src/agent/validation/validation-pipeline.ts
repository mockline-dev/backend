import { logger } from '../../logger'
import type { GeneratedFile } from '../../types'
import type { ValidationError, ValidationResult } from '../../types'
import { runFixLoop, type FixTarget } from './fix-loop'
import { validatePython } from './python-validator'
import { venvManager } from './venv-manager'

export interface ValidationPipelineResult {
  files: GeneratedFile[]
  passed: boolean
  errors: ValidationError[]
}

/**
 * Runs the full validation + AI-fix-loop pipeline for a generated project.
 *
 * Phases:
 *   1. Validate every .py file (syntax → ruff → venv-pyflakes).
 *   2. If any files fail, run the AI fix loop (up to 5 rounds).
 *   3. Return the final set of (possibly corrected) files and overall pass/fail.
 *
 * Constraint: sequential — no parallel LLM calls (single GPU).
 */
export async function executeValidationPipeline(
  projectId: string,
  files: GeneratedFile[],
  requirementsTxt: string,
  onProgress: (phase: string, detail: string) => void
): Promise<ValidationPipelineResult> {
  onProgress('validating', 'Starting validation...')

  // Ensure venv exists for import checking
  try {
    await venvManager.getOrCreate(projectId, requirementsTxt)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn('ValidationPipeline: venv creation failed (continuing without): %s', msg)
  }

  // ── Phase 1: validate all Python files ────────────────────────────────────
  const failTargets: FixTarget[] = []
  const allErrors: ValidationError[] = []
  const pyFiles = files.filter(f => f.path.endsWith('.py'))

  for (const file of pyFiles) {
    const result = await validatePython(file.path, file.content, venvManager, projectId)
    if (!result.valid && result.errors.length > 0) {
      const mapped: ValidationError[] = result.errors.map(e => ({
        file: file.path,
        line: e.line,
        code: e.code,
        message: e.message,
        severity: 'error' as const
      }))
      allErrors.push(...mapped)
      failTargets.push({ file, errors: result.errors })
    }
  }

  const firstResult: ValidationResult = {
    passed: failTargets.length === 0,
    errors: allErrors,
    round: 1
  }

  if (firstResult.passed) {
    onProgress('validated', 'All checks passed ✓')
    return { files, passed: true, errors: [] }
  }

  // ── Phase 2: AI fix loop ──────────────────────────────────────────────────
  onProgress('fixing', `Found ${failTargets.length} file(s) with errors, starting fix loop...`)
  logger.info(
    'ValidationPipeline: %d file(s) failed validation for project %s',
    failTargets.length,
    projectId
  )

  const workingFiles = [...files]
  let round = 0
  const maxRounds = 5

  let currentTargets = failTargets
  let lastErrorCount = currentTargets.length

  while (round < maxRounds && currentTargets.length > 0) {
    round++
    onProgress('fixing', `Round ${round}: fixing ${currentTargets.length} file(s)`)

    const { fixed, failed } = await runFixLoop(currentTargets, {
      validate: async (path, content) => {
        const r = await validatePython(path, content, venvManager, projectId)
        return r.errors
      },
      maxAttempts: 1  // Each outer round does 1 LLM attempt; outer loop is the retry
    })

    // Apply fixes into working files
    for (const fix of fixed) {
      const idx = workingFiles.findIndex(f => f.path === fix.path)
      if (idx >= 0) workingFiles[idx] = { ...workingFiles[idx], content: fix.content }
    }

    // Stagnation guard — if no improvement, stop
    if (failed.length >= lastErrorCount) {
      onProgress('fixing', 'Errors not improving, stopping fix loop')
      logger.warn(
        'ValidationPipeline: stagnation detected after round %d for project %s',
        round,
        projectId
      )
      break
    }
    lastErrorCount = failed.length

    if (failed.length === 0) break
    currentTargets = failed
  }

  // Final validation pass to collect remaining errors
  const finalErrors: ValidationError[] = []
  for (const file of workingFiles.filter(f => f.path.endsWith('.py'))) {
    const result = await validatePython(file.path, file.content, venvManager, projectId)
    if (!result.valid) {
      for (const e of result.errors) {
        finalErrors.push({
          file: file.path,
          line: e.line,
          code: e.code,
          message: e.message,
          severity: 'error'
        })
      }
    }
  }

  const passed = finalErrors.length === 0
  if (passed) {
    onProgress('validated', `All errors fixed after ${round} round(s) ✓`)
  } else {
    onProgress('fixing', `${finalErrors.length} error(s) remain after ${round} round(s)`)
  }

  return { files: workingFiles, passed, errors: finalErrors }
}
