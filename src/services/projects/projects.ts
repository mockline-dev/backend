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
      find: [],
      get: [],
      create: [
        async (context: HookContext) => {
        const {user} = context.params
        context.data.userId = user._id
        context.data.status = 'initializing'
        // Initialize progress tracking fields
        context.data.filesGenerated = 0
        context.data.totalFiles = 0
        context.data.generationProgress = 0
        context.data.currentStage = 'initializing'
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
      patch: [
        async (context: HookContext) => {
          // Broadcast progress updates to all clients when progress fields change
          const { data, result } = context
          const projectId = context.id || result._id

          if (projectId && (
            data.status ||
            data.generationProgress !== undefined ||
            data.filesGenerated !== undefined ||
            data.totalFiles !== undefined ||
            data.currentStage
          )) {
            const projectsService = app.service('projects')
            projectsService.emit('progress', {
              projectId,
              status: result.status,
              progress: result.generationProgress,
              filesGenerated: result.filesGenerated,
              totalFiles: result.totalFiles,
              currentStage: result.currentStage,
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

          // Don't await — run AI generation in background so the create response returns immediately
          ;(async () => {
            try {
              // Transition: initializing → generating
              await app.service('projects')._patch(projectId, {
                status: 'generating',
                generationProgress: 10,
                currentStage: 'analyzing_requirements'
              })

              // Estimate total files based on framework
              const estimatedFiles = result.framework === 'feathers' ? 10 : 8
              await app.service('projects')._patch(projectId, {
                totalFiles: estimatedFiles,
                generationProgress: 20,
                currentStage: 'generating_code'
              })

              const aiResponse = await app.service('ai-service').create({
                projectId,
                prompt: result.description || result.name
              })

              if (aiResponse.success) {
                // Update progress based on generated files
                const filesGenerated = aiResponse.generatedFiles?.filter((f: any) => f.uploadSuccess).length || 0
                await app.service('projects')._patch(projectId, {
                  status: 'validating',
                  filesGenerated,
                  generationProgress: 85,
                  currentStage: 'validating_files'
                })

                // Simulate validation delay
                await new Promise(resolve => setTimeout(resolve, 1000))

                // Transition: validating → ready
                await app.service('projects')._patch(projectId, {
                  status: 'ready',
                  generationProgress: 100,
                  currentStage: 'complete'
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
                  errorMessage: aiResponse.error || 'AI generation failed',
                  generationProgress: 0,
                  currentStage: 'error'
                })
              }
            } catch (error: any) {
              console.error(`Project ${projectId} generation failed:`, error)
              try {
                await app.service('projects')._patch(projectId, {
                  status: 'error',
                  errorMessage: error.message || 'Unexpected error during generation',
                  generationProgress: 0,
                  currentStage: 'error'
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
