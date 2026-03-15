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
import { logger } from '../../logger'
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
    events: ['progress']
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
          context.data.status = 'initializing'
          // Keep progress in the nested object to match the validated schema.
          context.data.generationProgress = {
            percentage: 0,
            currentStage: 'initializing',
            filesGenerated: 0,
            totalFiles: 0
          }
          if (context.data.framework) {
            context.data.framework = context.data.framework.toLowerCase()
          } else {
            context.data.framework = 'fast-api'
          }
          if (context.data.language) {
            context.data.language = context.data.language.toLowerCase()
          } else {
            context.data.language = 'python'
          }
          return context
        },
        schemaHooks.validateData(projectsDataValidator),
        schemaHooks.resolveData(projectsDataResolver)
      ],
      patch: [
        async (context: HookContext) => {
          // Validate status transitions
          if (context.data.status) {
            const existing = await context.service.get(context.id)
            if (existing?.status) {
              assertValidTransition(existing.status, context.data.status)
            }
          }
          if (context.data.framework) {
            context.data.framework = context.data.framework.toLowerCase()
          }
          if (context.data.language) {
            context.data.language = context.data.language.toLowerCase()
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
          }

          return context
        }
      ],
      create: [
        async (context: HookContext) => {
          const result = context.result
          const projectId = result._id
          const user = context.params.user

          try {
            // Await enqueueing the generation job directly to ensure it isn't lost
            await app.service('ai-service').create(
              {
                projectId,
                prompt: result.description || result.name
              },
              { user }
            )
          } catch (error: any) {
            logger.error(`Project ${projectId} AI generation enqueue failed:`, error.message)
            try {
              await app.service('projects')._patch(projectId, {
                status: 'error',
                errorMessage: error.message || 'Failed to enqueue generation job',
                errorType: 'permanent_error',
                generationProgress: {
                  percentage: 0,
                  currentStage: 'error',
                  filesGenerated: 0,
                  totalFiles: 0,
                  failedAt: Date.now()
                }
              })
            } catch (patchError) {
              logger.error(`Failed to update project ${projectId} error status:`, patchError)
            }
          }

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
            logger.error(`[Projects Service] Validation error on ${method}:`, {
              error: error.message,
              data: context.data,
              params: params,
              validationErrors: error.data || error.errors
            })
          } else {
            // Log other errors
            logger.error(`[Projects Service] Error on ${method}:`, {
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
