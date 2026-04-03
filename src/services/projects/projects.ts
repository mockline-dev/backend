// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'

import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  projectsDataResolver,
  projectsDataValidator,
  projectsExternalResolver,
  projectsPatchResolver,
  projectsPatchValidator,
  projectsQueryResolver,
  projectsQueryValidator,
  projectsResolver
} from './projects.schema'

import type { Application, HookContext } from '../../declarations'
import { excludeDeleted, softDelete } from '../../hooks/soft-delete'
import { ProjectsService, getOptions } from './projects.class'
import { projectsMethods, projectsPath } from './projects.shared'
import { assertValidTransition } from './projects.state-machine'

export * from './projects.class'
export * from './projects.schema'

// A configure function that registers the service and its hooks via `app.configure`
export const projects = (app: Application) => {
  // Register our service on the Feathers application
  app.use(projectsPath, new ProjectsService(getOptions(app)), {
    // A list of all methods this service exposes externally
    methods: projectsMethods,
    // You can add additional custom events to be sent to clients here
    events: ['progress', 'project:ready']
  })
  // Initialize hooks
  app.service(projectsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        schemaHooks.resolveExternal(projectsExternalResolver),
        schemaHooks.resolveResult(projectsResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(projectsQueryValidator),
        schemaHooks.resolveQuery(projectsQueryResolver)
      ],
      find: [excludeDeleted],
      get: [excludeDeleted],
      create: [
        async (context: HookContext) => {
          const { user } = context.params
          context.data.userId = user._id
          context.data.status = 'created'
          // Keep progress in the nested object to match the validated schema.
          context.data.generationProgress = {
            percentage: 0,
            currentStage: 'created',
            filesGenerated: 0,
            totalFiles: 0
          }
          context.data.framework = context.data.framework || 'fast-api'
          context.data.language = context.data.language || 'python'
          return context
        },
        schemaHooks.validateData(projectsDataValidator),
        schemaHooks.resolveData(projectsDataResolver)
      ],
      patch: [
        async (context: HookContext) => {
          // Validate status transitions — fetch current project to get actual current status
          if (context.data.status && context.id) {
            try {
              const current = await context.app.service('projects').get(context.id as string)
              assertValidTransition(current.status, context.data.status)
            } catch (err: any) {
              // Only rethrow transition errors, not fetch errors
              if (err.name === 'BadRequest' || err.message?.includes('Invalid transition')) {
                throw err
              }
            }
          }
          return context
        },
        schemaHooks.validateData(projectsPatchValidator),
        schemaHooks.resolveData(projectsPatchResolver)
      ],
      remove: [softDelete]
    },
    after: {
      all: [],
      patch: [
        async (context: HookContext) => {
          // Broadcast progress updates to all clients when progress fields change
          const { data, result } = context
          const projectId = context.id || result._id
          const progress = result.generationProgress || {}

          if (
            projectId &&
            (data.status ||
              data.generationProgress !== undefined ||
              data.filesGenerated !== undefined ||
              data.totalFiles !== undefined ||
              data.currentStage)
          ) {
            const projectsService = app.service('projects')
            projectsService.emit('progress', {
              projectId,
              status: result.status,
              progress,
              filesGenerated: progress.filesGenerated ?? 0,
              totalFiles: progress.totalFiles ?? 0,
              currentStage: progress.currentStage || result.status,
              errorMessage: result.errorMessage
            })

            // Emit project:ready event when status transitions to ready
            if (result.status === 'ready') {
              projectsService.emit('project:ready', { projectId })
            }
          }

          return context
        }
      ],
      create: [
        async (context: HookContext) => {
          const result = context.result
          const projectId = result._id
          const user = context.params.user

          // Don't await — run AI generation in background so the create response returns immediately
          ;(async () => {
            const maxRetries = 2
            let attempt = 0
            let lastError: any = null

            while (attempt < maxRetries) {
              try {
                await app.service('ai-service').create(
                  {
                    projectId,
                    prompt: result.description || result.name
                  },
                  { user }
                )
                // Success - break out of retry loop
                break
              } catch (error: any) {
                lastError = error
                attempt++

                // Check if error is retryable
                const isRetryable = error.message?.includes('timeout') ||
                                   error.message?.includes('network') ||
                                   error.message?.includes('ECONN') ||
                                   error.code === 'ECONNRESET' ||
                                   error.code === 'ETIMEDOUT'

                if (!isRetryable || attempt >= maxRetries) {
                  // Non-retryable error or max retries reached
                  console.error(`Project ${projectId} generation failed (attempt ${attempt}):`, error.message)
                  try {
                    await app.service('projects')._patch(projectId, {
                      status: 'error',
                      errorMessage: error.message || 'Unexpected error during generation',
                      errorType: isRetryable ? 'retryable_error' : 'permanent_error',
                      retryAttempts: attempt,
                      generationProgress: {
                        percentage: 0,
                        currentStage: 'error',
                        filesGenerated: 0,
                        totalFiles: 0,
                        failedAt: Date.now()
                      }
                    })
                  } catch (patchError) {
                    console.error(`Failed to update project ${projectId} error status:`, patchError)
                  }
                  break
                }

                // Retry with exponential backoff
                const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
                console.warn(`Project ${projectId} generation failed, retrying in ${backoffDelay}ms (attempt ${attempt}/${maxRetries})`)
                await new Promise(resolve => setTimeout(resolve, backoffDelay))
              }
            }
          })()

          return context
        }
      ]
    },
    error: {
      all: [
        async (context: HookContext) => {
          const { error, method, params } = context

          // Log validation errors with details
          if (error?.name === 'BadRequest' || error?.name === 'ValidationError') {
            console.error(`[Projects Service] Validation error on ${method}:`, {
              error: error.message,
              data: context.data,
              params: params,
              validationErrors: error.data || error.errors
            })
          } else {
            // Log other errors
            console.error(`[Projects Service] Error on ${method}:`, {
              error: error?.message || error,
              stack: error?.stack,
              data: context.data,
              params: params
            })
          }

          return context
        }
      ]
    }
  })
}

// Add this service to the service type index
declare module '../../declarations' {
  interface ServiceTypes {
    [projectsPath]: ProjectsService
  }
}
