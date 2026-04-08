import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { NotFound } from '@feathersjs/errors'

import {
  sessionsDataResolver,
  sessionsDataValidator,
  sessionsExternalResolver,
  sessionsPatchResolver,
  sessionsPatchValidator,
  sessionsQueryResolver,
  sessionsQueryValidator,
  sessionsResolver
} from './sessions.schema'

import type { Application, HookContext } from '../../declarations'
import { SessionsService, getOptions } from './sessions.class'
import { sessionsPath, sessionsMethods } from './sessions.shared'
import { startProjectExecution, stopProjectExecution } from '../../orchestration/sandbox/execution'
import { repairExecutionSandbox } from '../../orchestration/sandbox/repair'
import { createModuleLogger } from '../../logging'

const log = createModuleLogger('sessions-service')

// In-memory map of sessionId -> sandbox instance for lifecycle management
const activeSandboxes = new Map<string, any>()

export function getActiveSandbox(sessionId: string): any | undefined {
  return activeSandboxes.get(sessionId)
}

export * from './sessions.class'
export * from './sessions.schema'

export const sessions = (app: Application) => {
  app.use(sessionsPath, new SessionsService(getOptions(app)), {
    methods: sessionsMethods,
    events: ['terminal:stdout', 'terminal:stderr']
  })

  app.service(sessionsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        schemaHooks.resolveExternal(sessionsExternalResolver),
        schemaHooks.resolveResult(sessionsResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(sessionsQueryValidator),
        schemaHooks.resolveQuery(sessionsQueryResolver)
      ],
      create: [
        schemaHooks.validateData(sessionsDataValidator),
        schemaHooks.resolveData(sessionsDataResolver)
      ],
      patch: [
        schemaHooks.validateData(sessionsPatchValidator),
        schemaHooks.resolveData(sessionsPatchResolver)
      ]
    },
    after: {
      create: [
        // Start the sandbox container after session record is created
        async (context: HookContext) => {
          const session = context.result
          const sessionId = session._id?.toString()
          if (!sessionId) return

          const sandboxConfig = app.get('sandbox')
          if (!sandboxConfig?.opensandbox?.apiKey) {
            log.warn('No sandbox API key configured — cannot start execution container', { sessionId })
            await app.service(sessionsPath).patch(sessionId, {
              status: 'error',
              errorMessage: 'Sandbox not configured'
            })
            return
          }

          const emit = (event: string, pid: string, payload: unknown) => {
            try {
              app.service(sessionsPath).emit(event, { projectId: pid, sessionId, ...(payload as object) })
            } catch {
              /* non-fatal */
            }
          }

          // Start sandbox asynchronously — emit events when ready
          startProjectExecution(session.projectId.toString(), session.language, sandboxConfig, emit)
            .then(async ({ containerId, proxyUrl, endpointHeaders, port, sandbox, serverReady, serverLog }) => {
              activeSandboxes.set(sessionId, sandbox)

              // Emit server log to frontend so terminal shows complete output
              if (serverLog) {
                emit('terminal:stdout', session.projectId.toString(), { phase: 'server', text: serverLog })
              }

              if (serverReady) {
                await app.service(sessionsPath).patch(sessionId, {
                  status: 'running',
                  containerId,
                  proxyUrl,
                  endpointHeaders,
                  port,
                  serverLog: serverLog.slice(-2000),
                  startedAt: Date.now()
                })

                // Update project status
                await app
                  .service('projects')
                  .patch(session.projectId.toString(), {
                    status: 'running'
                  })
                  .catch(() => {
                    /* non-fatal */
                  })

                log.info('Execution sandbox started', { sessionId, containerId, proxyUrl })
              } else {
                const maxRepairAttempts: number = sandboxConfig.maxRepairAttempts ?? 2

                if (maxRepairAttempts > 0) {
                  // Launch the self-healing repair loop asynchronously (non-blocking)
                  repairExecutionSandbox({
                    sessionId,
                    session,
                    failedSandbox: sandbox,
                    serverLog,
                    app,
                    emit,
                    activeSandboxes,
                    maxAttempts: maxRepairAttempts
                  }).catch((err: unknown) => {
                    log.error('Repair loop threw unexpectedly', {
                      sessionId,
                      error: err instanceof Error ? err.message : String(err)
                    })
                  })
                } else {
                  const errMsg = serverLog
                    ? `Server failed to start. Log: ${serverLog.slice(-300)}`
                    : 'Server did not respond within timeout'
                  log.error('Server failed to start (repair disabled)', { sessionId, serverLog: serverLog.slice(-500) })

                  await app.service(sessionsPath).patch(sessionId, {
                    status: 'error',
                    containerId,
                    proxyUrl,
                    endpointHeaders,
                    port,
                    serverLog: serverLog.slice(-2000),
                    errorMessage: errMsg
                  }).catch(() => { /* non-fatal */ })
                }
              }
            })
            .catch(async (err: unknown) => {
              const message = err instanceof Error ? err.message : String(err)
              log.error('Failed to start execution sandbox', { sessionId, error: message })

              await app
                .service(sessionsPath)
                .patch(sessionId, {
                  status: 'error',
                  errorMessage: message
                })
                .catch(() => {
                  /* non-fatal */
                })
            })
        }
      ],
      remove: [
        // Stop the sandbox container when session is removed
        async (context: HookContext) => {
          const session = context.result
          const sessionId = session._id?.toString()
          if (!sessionId) return

          const sandbox = activeSandboxes.get(sessionId)
          if (sandbox) {
            activeSandboxes.delete(sessionId)
            await stopProjectExecution(sandbox)
            log.info('Execution sandbox stopped', { sessionId })
          }

          // Revert project status to ready
          await app
            .service('projects')
            .patch(session.projectId.toString(), {
              status: 'ready'
            })
            .catch(() => {
              /* non-fatal */
            })
        }
      ]
    },
    error: {
      all: []
    }
  })
}

declare module '../../declarations' {
  interface ServiceTypes {
    [sessionsPath]: SessionsService
  }
}
