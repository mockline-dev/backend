import * as fs from 'fs'
import * as path from 'path'
import { createLogger, format, transports } from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'

const LOG_DIR = path.resolve(process.cwd(), 'logs')
const SESSION_ID = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

const jsonFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.json()
)

/**
 * Session-aware file logger.
 *
 * Writes two log streams:
 *   - logs/session-{timestamp}.log  — one file per server start, full session trace
 *   - logs/combined-%DATE%.log      — daily rotating combined log for all sessions
 */
export const sessionLogger = createLogger({
  level: 'debug',
  defaultMeta: { sessionId: SESSION_ID },
  format: jsonFormat,
  transports: [
    // Per-session log file
    new transports.File({
      filename: path.join(LOG_DIR, `session-${SESSION_ID}.log`),
      level: 'debug',
    }),
    // Daily rotating combined log
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      level: 'info',
      zippedArchive: false,
    }),
  ],
})

/**
 * Returns a child logger pre-tagged with the given module name.
 * Use this in orchestration modules for structured logs.
 *
 * @example
 * const log = createModuleLogger('groq-provider')
 * log.info('Request sent', { model, tokens })
 */
export function createModuleLogger(module: string) {
  return sessionLogger.child({ module })
}

/**
 * Patches the app's main winston logger (src/logger.ts) to also write to session files.
 * Call once from app.ts before services start.
 */
export function configureSessionLogger(appLogger: ReturnType<typeof createLogger>) {
  appLogger.add(
    new transports.File({
      filename: path.join(LOG_DIR, `session-${SESSION_ID}.log`),
      level: 'debug',
      format: jsonFormat,
    })
  )
  appLogger.add(
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      level: 'info',
      zippedArchive: false,
      format: jsonFormat,
    })
  )

  appLogger.info('Session logger configured', { sessionId: SESSION_ID, logDir: LOG_DIR })
}

export { SESSION_ID }
