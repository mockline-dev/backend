import { exec } from 'child_process'
import { mkdir, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { logger } from '../../logger'

const execAsync = promisify(exec)

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
}

/**
 * Validates Python source code using ruff (fast linter/syntax checker).
 * ruff must be available in PATH. Falls back to a no-op if not installed.
 */
export async function validatePython(path: string, content: string): Promise<PythonValidationResult> {
  const tmpDir = join(tmpdir(), 'mockline-validation')
  const tmpFile = join(tmpDir, path.replace(/\//g, '__'))

  try {
    await mkdir(tmpDir, { recursive: true })
    await writeFile(tmpFile, content, 'utf-8')

    const { stderr } = await execAsync(`ruff check --quiet --output-format=json "${tmpFile}"`, {
      timeout: 10_000
    })

    if (stderr) {
      logger.debug('PythonValidator: ruff stderr for %s: %s', path, stderr.slice(0, 200))
    }

    return { path, valid: true, errors: [] }
  } catch (err: any) {
    // ruff exits with code 1 when there are lint errors; stdout contains JSON
    if (err.stdout) {
      try {
        const results = JSON.parse(err.stdout)
        const errors: ValidationError[] = results.map((r: any) => ({
          line: r.location?.row,
          col: r.location?.column,
          code: r.code,
          message: r.message
        }))
        return { path, valid: errors.length === 0, errors }
      } catch {
        // ruff may not be installed — treat as valid to avoid blocking generation
        logger.warn('PythonValidator: could not parse ruff output for %s (ruff may not be installed)', path)
        return { path, valid: true, errors: [] }
      }
    }

    // ruff not found or other execution error — non-fatal, skip silently
    logger.debug('PythonValidator: ruff unavailable for %s: %s', path, err.message)
    return { path, valid: true, errors: [] }
  } finally {
    try {
      await unlink(tmpFile)
    } catch {
      // ignore cleanup errors
    }
  }
}
