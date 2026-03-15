// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { NotFound } from '@feathersjs/errors'
import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  stackExternalResolver,
  stackQueryResolver,
  stackQueryValidator,
  stackResolver
} from './stacks.schema'

import type { Application } from '../../declarations'
import { StackService } from './stacks.class'
import { stackMethods, stacksPath } from './stacks.shared'

export * from './stacks.class'
export * from './stacks.schema'

/**
 * Configure and register the stacks service
 * Stacks are read-only and don't require authentication
 */
export const stacks = (app: Application) => {
  // Register our service on the Feathers application
  app.use(stacksPath, new StackService(app), {
    // A list of all methods this service exposes externally
    methods: stackMethods,
    // You can add additional custom events to be sent to clients here
    events: []
  })

  // Initialize hooks
  app.service(stacksPath).hooks({
    around: {
      all: [schemaHooks.resolveExternal(stackExternalResolver), schemaHooks.resolveResult(stackResolver)]
    },
    before: {
      all: [schemaHooks.validateQuery(stackQueryValidator), schemaHooks.resolveQuery(stackQueryResolver)],
      find: [],
      get: [
        // Add error handling for get method to return proper 404
        async (context: any) => {
          try {
            return context
          } catch (error: any) {
            if (error.message?.includes('not found')) {
              throw new NotFound(error.message)
            }
            throw error
          }
        }
      ]
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
    [stacksPath]: StackService
  }
}
