// AI Files Service Configuration and Registration
import { AIFilesService, getOptions } from './ai-files.class'
import {
  aiFileDataResolver,
  aiFileDataValidator,
  aiFilePatchResolver,
  aiFilePatchValidator,
  aiFileQueryResolver,
  aiFileQueryValidator
} from './ai-files.schema'

import { authenticate } from '@feathersjs/authentication'
import type { Application } from '../../declarations'

export const aiFiles = (app: Application) => {
  app.use('ai-files', new AIFilesService(getOptions(app)))

  // Register hooks
  app.service('ai-files').hooks({
    around: {
      all: [authenticate('jwt')]
    },
    before: {
      all: [aiFileQueryResolver],
      find: [aiFileQueryValidator],
      get: [aiFileQueryValidator],
      create: [aiFileDataValidator, aiFileDataResolver],
      update: [aiFileDataValidator, aiFileDataResolver],
      patch: [aiFilePatchValidator, aiFilePatchResolver]
    },
    after: {},
    error: {}
  })
}
