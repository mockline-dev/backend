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
 * Falls back to `python3 -m py_compile` when ruff is unavailable.
 */
export async function validatePython(path: string, content: string): Promise<PythonValidationResult> {
  const tmpDir = join(tmpdir(), 'mockline-validation')
  const tmpFile = join(tmpDir, path.replace(/\//g, '__'))
  let ruffUnavailable = false
  let result: PythonValidationResult | null = null

  try {
    await mkdir(tmpDir, { recursive: true })
    await writeFile(tmpFile, content, 'utf-8')

    const { stderr } = await execAsync(`ruff check --quiet --output-format=json "${tmpFile}"`, {
      timeout: 10_000
    })

    if (stderr) {
      logger.debug('PythonValidator: ruff stderr for %s: %s', path, stderr.slice(0, 200))
    }

    result = { path, valid: true, errors: [] }
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
        result = { path, valid: errors.length === 0, errors }
      } catch {
        logger.warn('PythonValidator: could not parse ruff output for %s, falling back to py_compile', path)
        ruffUnavailable = true
      }
    }

    // ruff not found or other execution error — fallback to Python syntax compile check
    logger.debug('PythonValidator: ruff unavailable for %s: %s', path, err.message)
    ruffUnavailable = true
  }

  if (!result && ruffUnavailable) {
    try {
      await execAsync(`python3 -m py_compile "${tmpFile}"`, { timeout: 10_000 })
      result = { path, valid: true, errors: [] }
    } catch (compileErr: any) {
      const compileOutput = `${compileErr.stderr ?? ''}${compileErr.stdout ?? ''}`.trim()
      result = {
        path,
        valid: false,
        errors: [
          {
            message: compileOutput || `Python syntax validation failed for ${path}`
          }
        ]
      }
    }
  }

  try {
    await unlink(tmpFile)
  } catch {
    // ignore cleanup errors
  }

  if (result) {
    return result
  }

  return {
    path,
    valid: false,
    errors: [{ message: `Python validation could not determine result for ${path}` }]
  }
}
