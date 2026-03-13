// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'

import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  architectureDataValidator,
  architecturePatchValidator,
  architectureQueryValidator,
  architectureResolver,
  architectureExternalResolver,
  architectureDataResolver,
  architecturePatchResolver,
  architectureQueryResolver
} from './architecture.schema'

import type { Application } from '../../declarations'
import { ArchitectureService, getOptions } from './architecture.class'
import { architecturePath, architectureMethods } from './architecture.shared'

export * from './architecture.class'
export * from './architecture.schema'

// A configure function that registers the service and its hooks via `app.configure`
export const architecture = (app: Application) => {
  // Register our service on the Feathers application
  app.use(architecturePath, new ArchitectureService(getOptions(app)), {
    // A list of all methods this service exposes externally
    methods: architectureMethods,
    // You can add additional custom events to be sent to clients here
    events: []
  })
  // Initialize hooks
  app.service(architecturePath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        schemaHooks.resolveExternal(architectureExternalResolver),
        schemaHooks.resolveResult(architectureResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(architectureQueryValidator),
        schemaHooks.resolveQuery(architectureQueryResolver)
      ],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(architectureDataValidator),
        schemaHooks.resolveData(architectureDataResolver)
      ],
      patch: [
        schemaHooks.validateData(architecturePatchValidator),
        schemaHooks.resolveData(architecturePatchResolver)
      ],
      remove: []
    },
    after: {
      all: []
    },
    error: {
      all: []
    }
  })
}

// Add this service to the service type index
declare module '../../declarations' {
  interface ServiceTypes {
    [architecturePath]: ArchitectureService
  }
}
