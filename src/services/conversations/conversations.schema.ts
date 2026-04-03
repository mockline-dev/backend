import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { ConversationsService } from './conversations.class'

// A single message inside a conversation thread
const ConversationMessageSchema = Type.Object({
  role: Type.Union([
    Type.Literal('user'),
    Type.Literal('assistant'),
    Type.Literal('tool')
  ]),
  content: Type.String(),
  toolCall: Type.Optional(
    Type.Object({
      name: Type.String(),
      args: Type.Record(Type.String(), Type.Unknown())
    })
  ),
  toolResult: Type.Optional(
    Type.Object({
      success: Type.Boolean(),
      data: Type.Optional(Type.Unknown()),
      error: Type.Optional(Type.String())
    })
  ),
  timestamp: Type.Number()
})

// Main data model schema
export const conversationsSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    projectId: ObjectIdSchema(),
    userId: ObjectIdSchema(),
    title: Type.String(),
    messages: Type.Array(ConversationMessageSchema),
    createdAt: Type.Number(),
    updatedAt: Type.Number()
  },
  { $id: 'Conversations', additionalProperties: false }
)
export type Conversations = Static<typeof conversationsSchema>
export const conversationsValidator = getValidator(conversationsSchema, dataValidator)
export const conversationsResolver = resolve<Conversations, HookContext<ConversationsService>>({})
export const conversationsExternalResolver = resolve<Conversations, HookContext<ConversationsService>>({})

// Schema for creating new entries
export const conversationsDataSchema = Type.Pick(
  conversationsSchema,
  ['projectId', 'userId', 'title', 'messages'],
  { $id: 'ConversationsData' }
)
export type ConversationsData = Static<typeof conversationsDataSchema>
export const conversationsDataValidator = getValidator(conversationsDataSchema, dataValidator)
export const conversationsDataResolver = resolve<Conversations, HookContext<ConversationsService>>({
  createdAt: async () => Date.now(),
  updatedAt: async () => Date.now()
})

// Schema for updating existing entries
export const conversationsPatchSchema = Type.Partial(
  Type.Pick(conversationsSchema, ['title', 'messages', 'updatedAt']),
  { $id: 'ConversationsPatch' }
)
export type ConversationsPatch = Static<typeof conversationsPatchSchema>
export const conversationsPatchValidator = getValidator(conversationsPatchSchema, dataValidator)
export const conversationsPatchResolver = resolve<ConversationsPatch, HookContext<ConversationsService>>({
  updatedAt: async () => Date.now()
})

// Schema for allowed query properties
export const conversationsQueryProperties = Type.Pick(conversationsSchema, [
  '_id',
  'projectId',
  'userId',
  'createdAt',
  'updatedAt'
])
export const conversationsQuerySchema = Type.Intersect(
  [
    querySyntax(conversationsQueryProperties),
    Type.Object({}, { additionalProperties: false })
  ],
  { additionalProperties: false }
)
export type ConversationsQuery = Static<typeof conversationsQuerySchema>
export const conversationsQueryValidator = getValidator(conversationsQuerySchema, queryValidator)
export const conversationsQueryResolver = resolve<ConversationsQuery, HookContext<ConversationsService>>({})
