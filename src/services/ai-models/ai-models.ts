// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'

import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  aiModelDataResolver,
  aiModelDataValidator,
  aiModelPatchResolver,
  aiModelPatchValidator,
  aiModelQueryResolver,
  aiModelQueryValidator
} from './ai-models.schema'

import type { Application } from '../../declarations'
import { AIModelsService, getOptions } from './ai-models.class'
import { aiModelsMethods, aiModelsPath } from './ai-models.shared'

export * from './ai-models.class'
export * from './ai-models.schema'

// A configure function that registers the service and its hooks via `app.configure`
export const aiModels = (app: Application) => {
  // Register our service on the Feathers application
  app.use(aiModelsPath, new AIModelsService(getOptions(app)), {
    // A list of all methods this service exposes externally
    methods: aiModelsMethods,
    // You can add additional custom events to be sent to clients here
    events: []
  })
  // Initialize hooks
  app.service(aiModelsPath).hooks({
    around: {
        all: [authenticate('jwt')],
    },
    before: {
      all: [schemaHooks.validateQuery(aiModelQueryValidator), schemaHooks.resolveQuery(aiModelQueryResolver)],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(aiModelDataValidator),
        schemaHooks.resolveData(aiModelDataResolver)
      ],
      patch: [schemaHooks.validateData(aiModelPatchValidator),schemaHooks.resolveData(aiModelPatchResolver)],
      remove: []
    },
    after: {
      all: [],
      create: [],
      patch: []
    },
    error: {
      all: []
    }
  })
}

// Add this service to the service type index
declare module '../../declarations' {
  interface ServiceTypes {
    [aiModelsPath]: AIModelsService
  }
}
