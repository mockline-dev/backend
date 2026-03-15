// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'
import { BadRequest, Forbidden } from '@feathersjs/errors'

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
        authenticate('jwt'),
        schemaHooks.resolveExternal(architectureExternalResolver),
        schemaHooks.resolveResult(architectureResolver)
      ]
    },
    before: {
      all: [
        async (context: any) => {
          // Authorization: Verify user owns the project
          const userId = context.params.user?._id
          const projectId = context.id || context.data?.projectId

          // Skip for find operations (will be filtered by query)
          if (context.method === 'find') return context

          // Check if this is an internal call (no provider means direct service call)
          const isInternalCall = !context.params.provider

          // For internal calls, require explicit user context to be passed
          if (isInternalCall) {
            if (!userId) {
              throw new BadRequest('User context is required for internal service calls')
            }
          }

          // Verify user owns the project
          const project = await context.app.service('projects').get(projectId as any)

          // Defensive null checks before calling .toString()
          if (!userId) {
            throw new BadRequest('User ID is missing from request context')
          }

          if (!project.userId) {
            throw new BadRequest('Project does not have a valid owner')
          }

          if (project.userId.toString() !== userId.toString()) {
            throw new Forbidden('You do not have permission to access this architecture')
          }

          return context
        },
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
