import type { Params } from '@feathersjs/feathers'
import type { ClientApplication } from '../../client'
import type {
  Conversations,
  ConversationsData,
  ConversationsPatch,
  ConversationsQuery,
  ConversationsService
} from './conversations.class'

export type { Conversations, ConversationsData, ConversationsPatch, ConversationsQuery }

export type ConversationsClientService = Pick<
  ConversationsService<Params<ConversationsQuery>>,
  (typeof conversationsMethods)[number]
>

export const conversationsPath = 'conversations'

export const conversationsMethods: Array<keyof ConversationsService> = [
  'find',
  'get',
  'create',
  'patch',
  'remove'
]

export const conversationsClient = (client: ClientApplication) => {
  const connection = client.get('connection')
  client.use(conversationsPath, connection.service(conversationsPath), {
    methods: conversationsMethods
  })
}

declare module '../../client' {
  interface ServiceTypes {
    [conversationsPath]: ConversationsClientService
  }
}
