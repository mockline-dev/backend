// AI File Versions Service Configuration and Registration
import { AIFileVersionsService, getOptions } from './ai-file-versions.class'
import {
  aiFileVersionDataResolver,
  aiFileVersionDataValidator,
  aiFileVersionPatchResolver,
  aiFileVersionPatchValidator,
  aiFileVersionQueryResolver,
  aiFileVersionQueryValidator
} from './ai-file-versions.schema'

import { authenticate } from '@feathersjs/authentication'
import type { Application } from '../../declarations'

export const aiFileVersions = (app: Application) => {
  app.use('ai-file-versions', new AIFileVersionsService(getOptions(app)))

  // Register hooks
  app.service('ai-file-versions').hooks({
    around: {
      all: [authenticate('jwt')]
    },
    before: {
      all: [aiFileVersionQueryResolver],
      find: [aiFileVersionQueryValidator],
      get: [aiFileVersionQueryValidator],
      create: [aiFileVersionDataValidator, aiFileVersionDataResolver],
      update: [aiFileVersionDataValidator, aiFileVersionDataResolver],
      patch: [aiFileVersionPatchValidator, aiFileVersionPatchResolver]
    },
    after: {},
    error: {}
  })
}
