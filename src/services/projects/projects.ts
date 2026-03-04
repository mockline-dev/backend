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
import { ProjectsService, getOptions } from './projects.class'
import { projectsMethods, projectsPath } from './projects.shared'

export * from './projects.class'
export * from './projects.schema'

// A configure function that registers the service and its hooks via `app.configure`
export const projects = (app: Application) => {
  // Register our service on the Feathers application
  app.use(projectsPath, new ProjectsService(getOptions(app)), {
    // A list of all methods this service exposes externally
    methods: projectsMethods,
    // You can add additional custom events to be sent to clients here
    events: []
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
      find: [],
      get: [],
      create: [
        async (context: HookContext) => {
        const {user} = context.params
        context.data.userId = user._id
        context.data.status = 'initializing'
        return context
      },
        schemaHooks.validateData(projectsDataValidator),
        schemaHooks.resolveData(projectsDataResolver),
      ],
      patch: [
        schemaHooks.validateData(projectsPatchValidator),
        schemaHooks.resolveData(projectsPatchResolver)
      ],
      remove: []
    },
    after: {
      all: [],
      create: [
        async (context: HookContext) => {
          const result = context.result
          const projectId = result._id

          // Don't await — run AI generation in background so the create response returns immediately
          ;(async () => {
            try {
              // Transition: initializing → generating
              await app.service('projects')._patch(projectId, {
                status: 'generating'
              })

              const aiResponse = await app.service('ai-service').create({
                projectId,
                prompt: result.description || result.name
              })

              if (aiResponse.success) {
                // Transition: generating → ready
                await app.service('projects')._patch(projectId, {
                  status: 'ready'
                })

                // Auto-snapshot: capture initial generated state
                try {
                  await app.service('snapshots').create({
                    projectId,
                    label: 'Initial generation',
                    trigger: 'auto-generation',
                    files: [],
                    version: 1,
                    totalSize: 0,
                    fileCount: 0,
                    createdAt: Date.now()
                  })
                } catch (snapErr: any) {
                  console.error(`Failed to create initial snapshot for project ${projectId}:`, snapErr.message)
                }
              } else {
                // Transition: generating → error
                await app.service('projects')._patch(projectId, {
                  status: 'error',
                  errorMessage: aiResponse.error || 'AI generation failed'
                })
              }
            } catch (error: any) {
              console.error(`Project ${projectId} generation failed:`, error)
              try {
                await app.service('projects')._patch(projectId, {
                  status: 'error',
                  errorMessage: error.message || 'Unexpected error during generation'
                })
              } catch (patchError) {
                console.error(`Failed to update project ${projectId} error status:`, patchError)
              }
            }
          })()

          return context
        }
      ]
    },
    error: {
      all: []
    }
  })
}

// Add this service to the service type index
declare module '../../declarations' {
  interface ServiceTypes {
    [projectsPath]: ProjectsService
  }
}
