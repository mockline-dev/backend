import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  aiConversationsDataResolver,
  aiConversationsDataValidator,
  aiConversationsExternalResolver,
  aiConversationsPatchResolver,
  aiConversationsPatchValidator,
  aiConversationsQueryResolver,
  aiConversationsQueryValidator,
  aiConversationsResolver
} from './ai-conversations.schema'

import type { Application } from '../../declarations'
import { AiConversationsService, getOptions } from './ai-conversations.class'
import { aiConversationsMethods, aiConversationsPath } from './ai-conversations.shared'

export * from './ai-conversations.class'
export * from './ai-conversations.schema'

export const aiConversations = (app: Application) => {
  app.use(aiConversationsPath, new AiConversationsService(getOptions(app)), {
    methods: aiConversationsMethods,
    events: []
  })

  app.service(aiConversationsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        schemaHooks.resolveExternal(aiConversationsExternalResolver),
        schemaHooks.resolveResult(aiConversationsResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(aiConversationsQueryValidator),
        schemaHooks.resolveQuery(aiConversationsQueryResolver)
      ],
      create: [
        schemaHooks.validateData(aiConversationsDataValidator),
        schemaHooks.resolveData(aiConversationsDataResolver)
      ],
      patch: [
        schemaHooks.validateData(aiConversationsPatchValidator),
        schemaHooks.resolveData(aiConversationsPatchResolver)
      ]
    }
  })
}

declare module '../../declarations' {
  interface ServiceTypes {
    [aiConversationsPath]: AiConversationsService
  }
}
