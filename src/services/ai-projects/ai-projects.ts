// AI Projects Service Configuration and Registration
import { AIProjectsService, getOptions } from './ai-projects.class'
import {
  aiProjectDataResolver,
  aiProjectDataValidator,
  aiProjectPatchResolver,
  aiProjectPatchValidator,
  aiProjectQueryResolver,
  aiProjectQueryValidator
} from './ai-projects.schema'

import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import axios from 'axios'
import type { Application } from '../../declarations'
import { HookContext } from '../../declarations'
import { aiProjectMethods, aiProjectPath } from './ai-projects.shared'

export const aiProjects = (app: Application) => {
  app.use(aiProjectPath, new AIProjectsService(getOptions(app)), {
    methods: aiProjectMethods,
    events: []
  })

  // Get the service we just registered
  const service = app.service(aiProjectPath)

  // Register hooks following Feathers best practices
  service.hooks({
    around: {
      all: [authenticate('jwt')]
    },
    before: {
      all: [
        schemaHooks.validateQuery(aiProjectQueryValidator),
        schemaHooks.resolveQuery(aiProjectQueryResolver)
      ],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(aiProjectDataValidator),
        schemaHooks.resolveData(aiProjectDataResolver)
      ],
      update: [
        schemaHooks.validateData(aiProjectDataValidator),
        schemaHooks.resolveData(aiProjectDataResolver)
      ],
      patch: [
        schemaHooks.validateData(aiProjectPatchValidator),
        schemaHooks.resolveData(aiProjectPatchResolver)
      ],
      remove: []
    },
    after: {
      all: [],
      find: [],
      get: [],
      create: [
        async (context: HookContext) => {
          const project = context.result
          const aiServiceConfig = app.get('aiService')
          const aiServiceUrl = aiServiceConfig?.url || 'http://localhost:11434'

          // Don't block the response - trigger AI generation asynchronously
          process.nextTick(async () => {
            try {
              await axios.post(`${aiServiceUrl}/api/generate`, {
                prompt: project.description,
                model: 'phi3:mini',
                framework: project.framework,
                language: project.language,
                projectId: project._id
              }, {
                timeout: aiServiceConfig?.timeout || 300000
              })
              
              // Update project status to ready after successful generation
              await service.patch(project._id, { status: 'ready' })
            } catch (error) {
              console.error('Failed to trigger AI generation:', error)
              // Update project status to error
              try {
                await service.patch(project._id, { status: 'error' })
              } catch (patchError) {
                console.error('Failed to update project status:', patchError)
              }
            }
          })

          return context
        }
      ],
      update: [],
      patch: [],
      remove: []
    },
    error: {
      all: [],
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: []
    }
  })
}

// Add this service to the service type index
declare module '../../declarations' {
  interface ServiceTypes {
    [aiProjectPath]: AIProjectsService
  }
}
