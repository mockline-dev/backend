import { execFile } from 'child_process'
import { mkdir, rm, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { promisify } from 'util'

import { logger } from '../../logger'

const execFileAsync = promisify(execFile)

const BASE_DIR = '/tmp/mockline/venvs'
const INSTALL_TIMEOUT_MS = 120_000 // 2 min — heavy packages like numpy can be slow
const RUN_TIMEOUT_MS = 15_000      // 15 s per individual Python command
const VENV_MAX_AGE_MS = 2 * 60 * 60 * 1000 // 2 hours — recreate stale venvs

export interface VenvRunResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Manages per-project Python venvs in /tmp/mockline/venvs/{projectId}.
 *
 * Lifecycle:
 *   1. `getOrCreate(projectId, requirementsTxt)` — creates venv + pip install.
 *      Result is cached for VENV_MAX_AGE_MS; subsequent calls are a no-op.
 *   2. `run(projectId, args)` — runs `{venv}/bin/python3 args` with timeout.
 *   3. `cleanup(projectId)` — removes venv from disk and cache.
 *
 * Constraint: NEVER use Docker (16 GB RAM limit).
 */
export class VenvManager {
  /** Map<projectId, createdAtMs> */
  private readonly timestamps = new Map<string, number>()

  /**
   * Return the venv Python path for `projectId`, creating the venv and
   * installing `requirementsTxt` packages if needed (or if stale).
   */
  async getOrCreate(projectId: string, requirementsTxt: string): Promise<string> {
    const venvPath = join(BASE_DIR, projectId)
    const pythonBin = join(venvPath, 'bin', 'python3')

    const lastCreated = this.timestamps.get(projectId)
    const isFresh = lastCreated !== undefined && Date.now() - lastCreated < VENV_MAX_AGE_MS

    if (isFresh) {
      return pythonBin
    }

    logger.info('VenvManager: (re)creating venv for project %s', projectId)
    await mkdir(BASE_DIR, { recursive: true })

    // Remove stale venv
    await rm(venvPath, { recursive: true, force: true }).catch(() => {})

    // Create venv
    await execFileAsync('python3', ['-m', 'venv', '--clear', venvPath], {
      timeout: 30_000
    })

    // Pip install — best-effort; non-fatal if packages fail
    const reqFile = join(BASE_DIR, `${projectId}-req.txt`)
    await writeFile(reqFile, requirementsTxt, 'utf8')

    const pip = join(venvPath, 'bin', 'pip')
    try {
      await execFileAsync(
        pip,
        ['install', '-q', '--no-cache-dir', '--disable-pip-version-check', '--only-binary', ':all:', '-r', reqFile],
        { timeout: INSTALL_TIMEOUT_MS }
      )
      logger.info('VenvManager: pip install complete for project %s', projectId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn(
        'VenvManager: pip install partially failed for project %s (non-fatal): %s',
        projectId,
        msg.slice(0, 300)
      )
    } finally {
      await unlink(reqFile).catch(() => {})
    }

    this.timestamps.set(projectId, Date.now())
    return pythonBin
  }

  /**
   * Run `python3 args` inside the project's venv.
   * Throws if the venv does not exist (call `getOrCreate` first).
   */
  async run(projectId: string, args: string[]): Promise<VenvRunResult> {
    const pythonBin = join(BASE_DIR, projectId, 'bin', 'python3')

    try {
      const { stdout, stderr } = await execFileAsync(pythonBin, args, {
        timeout: RUN_TIMEOUT_MS
      })
      return { stdout, stderr, exitCode: 0 }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && ('stdout' in err || 'stderr' in err)) {
        const e = err as { stdout?: string | Buffer; stderr?: string | Buffer; code?: number }
        return {
          stdout: String(e.stdout ?? ''),
          stderr: String(e.stderr ?? ''),
          exitCode: typeof e.code === 'number' ? e.code : 1
        }
      }
      throw err
    }
  }

  /**
   * Remove the project's venv from disk and the cache.
   * Safe to call even if the venv was never created.
   */
  async cleanup(projectId: string): Promise<void> {
    const venvPath = join(BASE_DIR, projectId)
    try {
      await rm(venvPath, { recursive: true, force: true })
      this.timestamps.delete(projectId)
      logger.info('VenvManager: cleaned up venv for project %s', projectId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('VenvManager: cleanup failed for project %s: %s', projectId, msg)
    }
  }

  has(projectId: string): boolean {
    const ts = this.timestamps.get(projectId)
    return ts !== undefined && Date.now() - ts < VENV_MAX_AGE_MS
  }
}

/** Module-level singleton shared across validation runs */
export const venvManager = new VenvManager()
