// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'

import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  endpointsDataValidator,
  endpointsPatchValidator,
  endpointsQueryValidator,
  endpointsResolver,
  endpointsExternalResolver,
  endpointsDataResolver,
  endpointsPatchResolver,
  endpointsQueryResolver
} from './endpoints.schema'

import type { Application } from '../../declarations'
import { EndpointsService, getOptions } from './endpoints.class'
import { endpointsPath, endpointsMethods } from './endpoints.shared'

export * from './endpoints.class'
export * from './endpoints.schema'

// A configure function that registers the service and its hooks via `app.configure`
export const endpoints = (app: Application) => {
  // Register our service on the Feathers application
  app.use(endpointsPath, new EndpointsService(getOptions(app)), {
    // A list of all methods this service exposes externally
    methods: endpointsMethods,
    // You can add additional custom events to be sent to clients here
    events: []
  })
  // Initialize hooks
  app.service(endpointsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        schemaHooks.resolveExternal(endpointsExternalResolver),
        schemaHooks.resolveResult(endpointsResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(endpointsQueryValidator),
        schemaHooks.resolveQuery(endpointsQueryResolver)
      ],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(endpointsDataValidator),
        schemaHooks.resolveData(endpointsDataResolver)
      ],
      patch: [
        schemaHooks.validateData(endpointsPatchValidator),
        schemaHooks.resolveData(endpointsPatchResolver)
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
    [endpointsPath]: EndpointsService
  }
}
