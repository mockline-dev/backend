import { execFileSync } from 'child_process'
import type { Server } from 'http'
import { createServer as createNetServer } from 'net'

import { app } from './app'
import { validateConfig } from './config.validator'
import { logger } from './logger'
import { runStartupChecks, stopChromaProcess } from './startup-checks'

// Validate configuration before starting
validateConfig()

const port = app.get('port')
const host = app.get('host')
const PORT_RELEASE_WAIT_MS = 250
const MAX_LISTEN_RETRIES = 3

process.on('unhandledRejection', reason => logger.error('Unhandled Rejection %O', reason))

/** Returns true if something is already listening on `port`. */
function isPortBusy(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const probe = createNetServer()
    probe.once('error', () => resolve(true))
    probe.once('listening', () => {
      probe.close()
      resolve(false)
    })
    probe.listen(port)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Kill whatever process holds `port` and wait briefly for it to release. */
async function freePort(port: number): Promise<void> {
  logger.warn('Port %d already in use — killing stale process...', port)
  try {
    execFileSync('sh', ['-c', `lsof -ti:${port} 2>/dev/null | xargs kill -TERM 2>/dev/null; true`], {
      timeout: 3_000
    })

    // Give the process time to shutdown gracefully and release the socket.
    for (let i = 0; i < 8; i++) {
      if (!(await isPortBusy(port))) {
        return
      }
      await sleep(PORT_RELEASE_WAIT_MS)
    }

    logger.warn('Port %d is still busy after SIGTERM — forcing shutdown', port)
    execFileSync('sh', ['-c', `lsof -ti:${port} 2>/dev/null | xargs kill -KILL 2>/dev/null; true`], {
      timeout: 3_000
    })

    for (let i = 0; i < 8; i++) {
      if (!(await isPortBusy(port))) {
        return
      }
      await sleep(PORT_RELEASE_WAIT_MS)
    }
  } catch {
    logger.warn(
      'Could not auto-free port %d — kill the existing process manually: lsof -ti:%d | xargs kill',
      port,
      port
    )
  }
}

;(async () => {
  try {
    await runStartupChecks(app)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('Startup checks failed: %s', msg)
    process.exit(1)
  }

  // Free port if a stale process is still holding it (e.g. previous dev server)
  if (await isPortBusy(port)) {
    await freePort(port)
  }

  let server: Server | undefined
  for (let attempt = 1; attempt <= MAX_LISTEN_RETRIES; attempt++) {
    try {
      server = await app.listen(port)
      break
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''

      if (code !== 'EADDRINUSE' || attempt === MAX_LISTEN_RETRIES) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error('Failed to start server on port %d: %s', port, msg)
        stopChromaProcess()
        process.exit(1)
      }

      logger.warn('Port %d bind conflict on attempt %d/%d — retrying', port, attempt, MAX_LISTEN_RETRIES)
      await freePort(port)
      await sleep(PORT_RELEASE_WAIT_MS)
    }
  }

  if (!server) {
    logger.error('Failed to create HTTP server on port %d after retries', port)
    stopChromaProcess()
    process.exit(1)
  }

  const runningServer = server

  logger.info(`Feathers app listening on http://${host}:${port}`)

  function shutdown(signal: string): void {
    logger.info('Received %s — shutting down...', signal)
    stopChromaProcess()
    // closeAllConnections() immediately destroys all sockets so server.close()
    // completes in <100ms instead of waiting for keep-alive / WebSocket draining.
    runningServer.closeAllConnections()
    runningServer.close(() => {
      logger.info('HTTP server closed.')
      process.exit(0)
    })
    setTimeout(() => {
      logger.warn('Forced exit after shutdown timeout.')
      process.exit(1)
    }, 5_000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
})()
