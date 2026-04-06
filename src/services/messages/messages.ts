import { authenticate } from '@feathersjs/authentication'
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

import type { Application, HookContext } from '../../declarations'
import { MessagesService, getOptions } from './messages.class'
import { messagesPath, messagesMethods } from './messages.shared'
import { orchestrationQueue } from '../redis/queues/queues'

export * from './messages.class'
export * from './messages.schema'

export const messages = (app: Application) => {
  app.use(messagesPath, new MessagesService(getOptions(app)), {
    methods: messagesMethods,
    events: []
  })

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
      create: [
        schemaHooks.validateData(messagesDataValidator),
        schemaHooks.resolveData(messagesDataResolver)
      ],
      patch: [
        schemaHooks.validateData(messagesPatchValidator),
        schemaHooks.resolveData(messagesPatchResolver)
      ]
    },
    after: {
      create: [
        // When a user message is created, auto-enqueue an orchestration job
        async (context: HookContext) => {
          const msg = context.result
          if (msg?.role !== 'user') return

          const projectId = msg.projectId?.toString()
          const userId = context.params.user?._id?.toString()
          if (!projectId || !userId) return

          // Fetch recent conversation history for this project
          const history = await app.service(messagesPath).find({
            query: {
              projectId,
              $sort: { createdAt: 1 },
              $limit: 50
            },
            paginate: false
          } as any)

          const conversationHistory = (Array.isArray(history) ? history : (history.data ?? [])).map(
            (m: any) => ({
              role: m.role as 'user' | 'assistant' | 'system',
              content: m.content
            })
          )

          const job = await orchestrationQueue.add(
            'orchestrate',
            {
              projectId,
              userId,
              prompt: msg.content,
              conversationHistory,
              messageId: msg._id?.toString()
            },
            {
              removeOnComplete: 100,
              removeOnFail: 50
            }
          )

          // Track jobId on the project
          await app
            .service('projects')
            .patch(projectId, {
              jobId: job.id,
              status: 'generating'
            })
            .catch(() => {
              /* non-fatal */
            })
        }
      ]
    },
    error: {
      all: []
    }
  })
}

declare module '../../declarations' {
  interface ServiceTypes {
    [messagesPath]: MessagesService
  }
}
