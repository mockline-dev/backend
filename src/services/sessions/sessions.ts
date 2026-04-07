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
    events: []
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

          // Start sandbox asynchronously — emit events when ready
          startProjectExecution(session.projectId.toString(), session.language, sandboxConfig)
            .then(async ({ containerId, proxyUrl, endpointHeaders, port, sandbox }) => {
              activeSandboxes.set(sessionId, sandbox)

              await app.service(sessionsPath).patch(sessionId, {
                status: 'running',
                containerId,
                proxyUrl,
                endpointHeaders,
                port,
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
