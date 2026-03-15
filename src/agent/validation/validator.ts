import { Application } from '../../declarations'
import { logger } from '../../logger'
import type { GeneratedFile } from '../pipeline/file-generator'
import { createInitializedRegistry } from '../stacks'
import { validatePython } from './python-validator'
import { validateTypeScript } from './ts-validator'

export interface FileValidationResult {
  path: string
  valid: boolean
  errors: Array<{ line?: number; code?: string; message: string }>
}

export interface ValidationSummary {
  passCount: number
  failCount: number
  results: FileValidationResult[]
}

/**
 * Validates all generated files and attempts to regenerate any that fail.
 * Returns a summary of pass/fail counts.
 * Now stack-aware - uses stack configuration to determine appropriate validator.
 */
export async function validateGeneratedFiles(
  files: GeneratedFile[],
  projectId: string,
  _app: Application,
  onProgress: (stage: string, pct: number) => Promise<void>,
  stackId?: string
): Promise<ValidationSummary> {
  const stackRegistry = createInitializedRegistry()
  const results: FileValidationResult[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const ext = file.path.split('.').pop()?.toLowerCase() ?? ''
    await onProgress(`Validating ${file.path}`, 90 + Math.round((i / files.length) * 5))

    let result: FileValidationResult

    // Use stack configuration to determine which validator to use
    const stack = stackId ? stackRegistry.get(stackId) : stackRegistry.getDefault()
    const language = stack?.language || 'Python'

    if (language === 'Python') {
      const r = await validatePython(file.path, file.content)
      result = r
    } else if (language === 'TypeScript') {
      const r = await validateTypeScript(file.path, file.content)
      result = r
    } else {
      result = { path: file.path, valid: true, errors: [] }
    }

    if (!result.valid && result.errors.length > 0) {
      logger.warn('Validator: %s has %d errors', file.path, result.errors.length)
    }

    results.push(result)
  }

  const failCount = results.filter(r => !r.valid).length
  return { passCount: results.length - failCount, failCount, results }
}
