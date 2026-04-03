import { mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'

import config from 'config'
import { createLogger, format, transports, type Logger } from 'winston'

import { logger as globalLogger } from './logger'

// ─── Config ───────────────────────────────────────────────────────────────────

interface PipelineLoggingConfig {
  enabled: boolean
  directory: string
  level: string
  maxAgeDays: number
}

function getLoggingConfig(): PipelineLoggingConfig {
  return config.get<PipelineLoggingConfig>('logging.pipeline')
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PipelineLoggerSet {
  pipeline: Logger
  intent: Logger
  planning: Logger
  generation: Logger
  validation: Logger
  close(): void
}

// ─── Factory ──────────────────────────────────────────────────────────────────

const STAGES = ['pipeline', 'intent', 'planning', 'generation', 'validation'] as const
type Stage = (typeof STAGES)[number]

export function createPipelineLogger(projectId: string, runId: string): PipelineLoggerSet {
  const cfg = getLoggingConfig()

  if (!cfg.enabled) {
    const noop = { close: () => {} } as unknown as PipelineLoggerSet
    for (const stage of STAGES) {
      ;(noop as unknown as Record<string, Logger>)[stage] = globalLogger
    }
    noop.close = () => {}
    return noop
  }

  const runDir = join(cfg.directory, projectId, runId)
  mkdirSync(runDir, { recursive: true })

  const logFormat = format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    format.splat(),
    format.printf(({ timestamp, level, message }) => `[${timestamp}] [${level.toUpperCase()}] ${message}`)
  )

  const combinedFilePath = join(runDir, 'pipeline.log')

  const fileTransports: transports.FileTransportInstance[] = []

  const loggers = {} as Record<Stage, Logger>

  for (const stage of STAGES) {
    const stageFilePath = join(runDir, `${stage}.log`)
    const stageFileTransport = new transports.File({ filename: stageFilePath, level: cfg.level, format: logFormat })
    const combinedFileTransport = new transports.File({ filename: combinedFilePath, level: cfg.level, format: logFormat })

    fileTransports.push(stageFileTransport, combinedFileTransport)

    loggers[stage] = createLogger({
      level: cfg.level,
      transports: [
        stageFileTransport,
        combinedFileTransport,
        new transports.Console({ level: 'info', format: format.combine(format.splat(), format.simple()) })
      ]
    })
  }

  return {
    ...loggers,
    close() {
      for (const transport of fileTransports) {
        transport.close?.()
      }
    }
  } as PipelineLoggerSet
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Delete run folders older than maxAgeDays under the logs directory.
 * Runs fire-and-forget — errors are logged as warnings.
 */
export function cleanupOldLogs(): void {
  const cfg = getLoggingConfig()
  if (!cfg.enabled) return

  const cutoffMs = cfg.maxAgeDays * 24 * 60 * 60 * 1000

  setImmediate(() => {
    try {
      const logsDir = cfg.directory
      const projectDirs = readdirSync(logsDir)

      for (const projectDir of projectDirs) {
        const projectPath = join(logsDir, projectDir)
        const stat = statSync(projectPath)
        if (!stat.isDirectory()) continue

        const runDirs = readdirSync(projectPath)
        for (const runDir of runDirs) {
          const runPath = join(projectPath, runDir)
          try {
            const runStat = statSync(runPath)
            if (!runStat.isDirectory()) continue
            if (Date.now() - runStat.mtimeMs > cutoffMs) {
              rmSync(runPath, { recursive: true, force: true })
              globalLogger.debug('PipelineLogger: cleaned up old log dir %s', runPath)
            }
          } catch {
            // skip individual run dirs that can't be read
          }
        }

        // Clean up empty project dirs
        try {
          if (readdirSync(projectPath).length === 0) {
            rmSync(projectPath, { recursive: true, force: true })
          }
        } catch {
          // skip
        }
      }
    } catch (err: unknown) {
      globalLogger.warn('PipelineLogger: log cleanup failed: %s', err instanceof Error ? err.message : String(err))
    }
  })
}
