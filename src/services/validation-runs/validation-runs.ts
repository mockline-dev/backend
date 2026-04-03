import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  validationRunsDataResolver,
  validationRunsDataValidator,
  validationRunsExternalResolver,
  validationRunsQueryResolver,
  validationRunsQueryValidator,
  validationRunsResolver
} from './validation-runs.schema'

import type { Application } from '../../declarations'
import { ValidationRunsService, getOptions } from './validation-runs.class'
import { validationRunsMethods, validationRunsPath } from './validation-runs.shared'

export * from './validation-runs.class'
export * from './validation-runs.schema'

export const validationRuns = (app: Application) => {
  app.use(validationRunsPath, new ValidationRunsService(getOptions(app)), {
    methods: validationRunsMethods,
    events: []
  })

  app.service(validationRunsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        schemaHooks.resolveExternal(validationRunsExternalResolver),
        schemaHooks.resolveResult(validationRunsResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(validationRunsQueryValidator),
        schemaHooks.resolveQuery(validationRunsQueryResolver)
      ],
      create: [
        schemaHooks.validateData(validationRunsDataValidator),
        schemaHooks.resolveData(validationRunsDataResolver)
      ]
    }
  })
}

declare module '../../declarations' {
  interface ServiceTypes {
    [validationRunsPath]: ValidationRunsService
  }
}
