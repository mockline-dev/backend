// AI Models Service Configuration and Registration
import { AIModelsService, getOptions } from './ai-models.class'
import {
  aiModelDataResolver,
  aiModelDataValidator,
  aiModelPatchResolver,
  aiModelPatchValidator,
  aiModelQueryResolver,
  aiModelQueryValidator
} from './ai-models.schema'

import { authenticate } from '@feathersjs/authentication'
import type { Application } from '../../declarations'

export const aiModels = (app: Application) => {
  app.use('ai-models', new AIModelsService(getOptions(app)))

  // Register hooks
  app.service('ai-models').hooks({
    around: {
      all: [authenticate('jwt')]
    },
    before: {
      all: [aiModelQueryResolver],
      find: [aiModelQueryValidator],
      get: [aiModelQueryValidator],
      create: [aiModelDataValidator, aiModelDataResolver],
      update: [aiModelDataValidator, aiModelDataResolver],
      patch: [aiModelPatchValidator, aiModelPatchResolver]
    },
    after: {},
    error: {}
  })
}
