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
import axios from 'axios'
import type { Application } from '../../declarations'

export const aiProjects = (app: Application) => {
  app.use('ai-projects', new AIProjectsService(getOptions(app)))

  // Register hooks
  app.service('ai-projects').hooks({
    around: {
      all: [authenticate('jwt')]
    },
    before: {
      all: [aiProjectQueryResolver],
      find: [aiProjectQueryValidator],
      get: [aiProjectQueryValidator],
      create: [aiProjectDataValidator, aiProjectDataResolver],
      update: [aiProjectDataValidator, aiProjectDataResolver],
      patch: [aiProjectPatchValidator, aiProjectPatchResolver]
    },
    after: {
      create: [
        async (context: any) => {
          const project = context.result
          const aiServiceUrl = app.get('aiService')?.url

          if (aiServiceUrl) {
            try {
              // Call AI service to generate code
              await axios.post(`${aiServiceUrl}/api/generate`, {
                prompt: project.description,
                model: 'llama3',
                framework: project.framework,
                language: project.language,
                projectId: project._id
              })
            } catch (error) {
              console.error('Failed to trigger AI generation:', error)
            }
          }
          return context
        }
      ]
    },
    error: {}
  })
}
