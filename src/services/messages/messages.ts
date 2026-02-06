// Messages Service Configuration and Registration
import { MessagesService, getOptions } from './messages.class'
import {
  messageDataResolver,
  messageDataValidator,
  messagePatchResolver,
  messagePatchValidator,
  messageQueryResolver,
  messageQueryValidator
} from './messages.schema'

import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import type { Application } from '../../declarations'

export const messages = (app: Application) => {
  app.use('messages', new MessagesService(getOptions(app)))

  // Register hooks
  app.service('messages').hooks({
    around: {
      all: [authenticate('jwt')]
    },
    before: {
      all: [
        schemaHooks.validateQuery(messageQueryValidator),
        schemaHooks.resolveQuery(messageQueryResolver)
      ],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(messageDataValidator),
        schemaHooks.resolveData(messageDataResolver)
      ],
      patch: [
        schemaHooks.validateData(messagePatchValidator),
        schemaHooks.resolveData(messagePatchResolver)
      ],
      remove: []
    },
    after: {},
    error: {}
  })
}
