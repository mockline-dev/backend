import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  modelsDataResolver,
  modelsDataValidator,
  modelsExternalResolver,
  modelsPatchResolver,
  modelsPatchValidator,
  modelsQueryResolver,
  modelsQueryValidator,
  modelsResolver
} from './models.schema'

import type { Application } from '../../declarations'
import { ModelsService, getOptions } from './models.class'
import { modelsMethods, modelsPath } from './models.shared'

export * from './models.class'
export * from './models.schema'

export const models = (app: Application) => {
  app.use(modelsPath, new ModelsService(getOptions(app)), {
    methods: modelsMethods,
    events: []
  })

  app.service(modelsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        schemaHooks.resolveExternal(modelsExternalResolver),
        schemaHooks.resolveResult(modelsResolver)
      ]
    },
    before: {
      all: [schemaHooks.validateQuery(modelsQueryValidator), schemaHooks.resolveQuery(modelsQueryResolver)],
      create: [schemaHooks.validateData(modelsDataValidator), schemaHooks.resolveData(modelsDataResolver)],
      patch: [schemaHooks.validateData(modelsPatchValidator), schemaHooks.resolveData(modelsPatchResolver)]
    },
    after: {
      all: []
    },
    error: {
      all: []
    }
  })
}
