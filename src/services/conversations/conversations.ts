import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'

import type { Application } from '../../declarations'
import { ConversationsService, getOptions } from './conversations.class'
import {
  conversationsDataResolver,
  conversationsDataValidator,
  conversationsExternalResolver,
  conversationsPatchResolver,
  conversationsPatchValidator,
  conversationsQueryResolver,
  conversationsQueryValidator,
  conversationsResolver
} from './conversations.schema'
import { conversationsMethods, conversationsPath } from './conversations.shared'

export * from './conversations.class'
export * from './conversations.schema'

export const conversations = (app: Application) => {
  app.use(conversationsPath, new ConversationsService(getOptions(app)), {
    methods: conversationsMethods,
    events: []
  })

  app.service(conversationsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        schemaHooks.resolveExternal(conversationsExternalResolver),
        schemaHooks.resolveResult(conversationsResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(conversationsQueryValidator),
        schemaHooks.resolveQuery(conversationsQueryResolver)
      ],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(conversationsDataValidator),
        schemaHooks.resolveData(conversationsDataResolver)
      ],
      patch: [
        schemaHooks.validateData(conversationsPatchValidator),
        schemaHooks.resolveData(conversationsPatchResolver)
      ],
      remove: []
    },
    after: { all: [] },
    error: { all: [] }
  })
}

declare module '../../declarations' {
  interface ServiceTypes {
    [conversationsPath]: ConversationsService
  }
}
