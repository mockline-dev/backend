// // For more information about this file see https://dove.feathersjs.com/guides/cli/service.schemas.html
import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { ConversationsService } from './conversations.class'

// Main data model schema
export const conversationsSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    userId: ObjectIdSchema(),
    title: Type.String(),
    aiModelId: ObjectIdSchema(),
    projectId: Type.Optional(ObjectIdSchema()),
    createdAt: Type.Number(),
    updatedAt: Type.Number(),
    status: Type.Union([Type.Literal('active'), Type.Literal('archived'), Type.Literal('deleted')])
  },
  { $id: 'Conversations', additionalProperties: false }
)
export type Conversations = Static<typeof conversationsSchema>
export const conversationsValidator = getValidator(conversationsSchema, dataValidator)
export const conversationsResolver = resolve<Conversations, HookContext<ConversationsService>>({
  userId: async (_value, _conversation, context) => {
    return context.params.user?._id
  },
  createdAt: async () => {
    return Date.now()
  },
  updatedAt: async () => {
    return Date.now()
  }
})

export const conversationsExternalResolver = resolve<Conversations, HookContext<ConversationsService>>({})

// Schema for creating new entries
export const conversationsDataSchema = Type.Pick(conversationsSchema, ['title', 'aiModelId', 'projectId'], {
  $id: 'ConversationsData'
})
export type ConversationsData = Static<typeof conversationsDataSchema>
export const conversationsDataValidator = getValidator(conversationsDataSchema, dataValidator)
export const conversationsDataResolver = resolve<Conversations, HookContext<ConversationsService>>({
  createdAt: async () => {
    return Date.now()
  },
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for updating existing entries
export const conversationsPatchSchema = Type.Partial(conversationsSchema, {
  $id: 'ConversationsPatch'
})
export type ConversationsPatch = Static<typeof conversationsPatchSchema>
export const conversationsPatchValidator = getValidator(conversationsPatchSchema, dataValidator)
export const conversationsPatchResolver = resolve<ConversationsPatch, HookContext<ConversationsService>>({
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for allowed query properties
export const conversationsQueryProperties = Type.Pick(conversationsSchema, [
  '_id',
  'userId',
  'title',
  'aiModelId',
  'projectId',
  'createdAt',
  'updatedAt',
  'status'
])
export const conversationsQuerySchema = Type.Intersect(
  [
    querySyntax(conversationsQueryProperties),
    // Add additional query properties here
    Type.Object({}, { additionalProperties: false })
  ],
  { additionalProperties: false }
)
export type ConversationsQuery = Static<typeof conversationsQuerySchema>
export const conversationsQueryValidator = getValidator(conversationsQuerySchema, queryValidator)
export const conversationsQueryResolver = resolve<ConversationsQuery, HookContext<ConversationsService>>({
  userId: async (value, _query, context) => {
    // If user is authenticated, only show their own conversations
    if (context.params.user) {
      return context.params.user._id
    }
    return value
  }
})
