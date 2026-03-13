import { exec } from 'child_process'
import { mkdir, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { logger } from '../../logger'

const execAsync = promisify(exec)

export interface TSValidationResult {
  path: string
  valid: boolean
  errors: Array<{ line?: number; message: string }>
}

/**
 * Validates TypeScript source code using the TypeScript compiler (tsc).
 * tsc must be available in PATH.  Falls back gracefully if unavailable.
 */
export async function validateTypeScript(path: string, content: string): Promise<TSValidationResult> {
  const tmpDir = join(tmpdir(), 'mockline-ts-validation')
  const tmpFile = join(tmpDir, path.replace(/\//g, '__') + '.ts')

  try {
    await mkdir(tmpDir, { recursive: true })
    await writeFile(tmpFile, content, 'utf-8')

    await execAsync(
      `npx tsc --noEmit --strict --target esnext --moduleResolution node --allowSyntheticDefaultImports --esModuleInterop "${tmpFile}"`,
      { timeout: 15_000 }
    )

    return { path, valid: true, errors: [] }
  } catch (err: any) {
    const output: string = (err.stdout ?? '') + (err.stderr ?? '')
    const errors = output
      .split('\n')
      .filter(l => l.includes('error TS'))
      .slice(0, 20)
      .map(l => {
        const lineMatch = l.match(/\((\d+),(\d+)\)/)
        const msg = l.replace(/^[^:]+: /, '').trim()
        return { line: lineMatch ? parseInt(lineMatch[1]) : undefined, message: msg }
      })

    if (errors.length === 0 && output.includes('Cannot find')) {
      // tsc not available
      logger.warn('TSValidator: tsc unavailable for %s', path)
      return { path, valid: true, errors: [] }
    }

    return { path, valid: false, errors }
  } finally {
    try {
      await unlink(tmpFile)
    } catch {
      // ignore
    }
  }
}
