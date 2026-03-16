// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { BadRequest } from '@feathersjs/errors'

import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  architectureDataResolver,
  architectureDataValidator,
  architectureExternalResolver,
  architecturePatchResolver,
  architecturePatchValidator,
  architectureQueryResolver,
  architectureQueryValidator,
  architectureResolver
} from './architecture.schema'

import { disallow } from 'feathers-hooks-common'
import type { Application } from '../../declarations'
import { ArchitectureService, getOptions } from './architecture.class'
import { architectureMethods, architecturePath } from './architecture.shared'

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
        schemaHooks.resolveExternal(architectureExternalResolver),
        schemaHooks.resolveResult(architectureResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(architectureQueryValidator),
        schemaHooks.resolveQuery(architectureQueryResolver)
      ],
      find: [
        async context => {
          if (!context.params.provider) {
            return context
          }

          const projectId = context.params.query?.projectId?.toString?.()
          if (!projectId) {
            throw new BadRequest('projectId query parameter is required')
          }

          context.params.query = {
            ...context.params.query,
            projectId
          }

          return context
        }
      ],
      get: [
        async context => {
          if (!context.params.provider) {
            return context
          }

          return context
        }
      ],
      create: [
        async context => {
          const { data } = context
          console.log('====================================')
          console.log(data)
          console.log('====================================')
        },
        schemaHooks.validateData(architectureDataValidator),
        schemaHooks.resolveData(architectureDataResolver)
      ],
      patch: [
        schemaHooks.validateData(architecturePatchValidator),
        schemaHooks.resolveData(architecturePatchResolver)
      ],
      remove: [disallow('external')]
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
