// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'
import { Forbidden } from '@feathersjs/errors'

import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  messagesDataResolver,
  messagesDataValidator,
  messagesExternalResolver,
  messagesPatchResolver,
  messagesPatchValidator,
  messagesQueryResolver,
  messagesQueryValidator,
  messagesResolver
} from './messages.schema'

import type { Application } from '../../declarations'
import { MessagesService, getOptions } from './messages.class'
import { messagesMethods, messagesPath } from './messages.shared'

export * from './messages.class'
export * from './messages.schema'

// A configure function that registers the service and its hooks via `app.configure`
export const messages = (app: Application) => {
  // Register our service on the Feathers application
  app.use(messagesPath, new MessagesService(getOptions(app)), {
    // A list of all methods this service exposes externally
    methods: messagesMethods,
    // You can add additional custom events to be sent to clients here
    events: []
  })
  // Initialize hooks
  app.service(messagesPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        schemaHooks.resolveExternal(messagesExternalResolver),
        schemaHooks.resolveResult(messagesResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(messagesQueryValidator),
        schemaHooks.resolveQuery(messagesQueryResolver)
      ],
      find: [],
      get: [],
      create: [
        async (context: any) => {
          if (!context.data?.type) {
            context.data.type = 'text'
          }

          // Authorization: Verify user owns the project
          const userId = context.params.user?._id
          const projectId = context.data.projectId

          if (projectId) {
            const project = await context.app.service('projects').get(projectId as any)

            // Null checks before calling toString()
            if (!project.userId) {
              throw new Forbidden('Project userId is missing')
            }
            if (!userId) {
              throw new Forbidden('User ID is missing')
            }

            if (project.userId.toString() !== userId.toString()) {
              // Use FeathersJS Forbidden error class
              throw new Forbidden('You do not have permission to create messages for this project')
            }
          }

          return context
        },
        schemaHooks.validateData(messagesDataValidator),
        schemaHooks.resolveData(messagesDataResolver)
      ],
      patch: [
        schemaHooks.validateData(messagesPatchValidator),
        schemaHooks.resolveData(messagesPatchResolver)
      ],
      remove: []
    },
    after: {
      all: []
    },
    error: {
      all: [
        async (context: any) => {
          const { error, method, params } = context

          if (error?.name === 'BadRequest' || error?.name === 'ValidationError') {
            console.error(`[Messages Service] Validation error on ${method}:`, {
              error: error.message,
              data: context.data,
              params,
              validationErrors: error.data || error.errors
            })
          }

          return context
        }
      ]
    }
  })
}

// Add this service to the service type index
declare module '../../declarations' {
  interface ServiceTypes {
    [messagesPath]: MessagesService
  }
}
