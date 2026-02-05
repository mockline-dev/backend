// // For more information about this file see https://dove.feathersjs.com/guides/cli/service.schemas.html
import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { MessagesService } from './messages.class'

// Main data model schema
export const messagesSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    conversationId: ObjectIdSchema(),
    role: Type.Union([Type.Literal('user'), Type.Literal('assistant'), Type.Literal('system')]),
    content: Type.String(),
    tokens: Type.Optional(Type.Number()),
    createdAt: Type.Number(),
    metadata: Type.Optional(
      Type.Object({
        model: Type.Optional(Type.String()),
        temperature: Type.Optional(Type.Number()),
        files: Type.Optional(Type.Array(ObjectIdSchema()))
      })
    )
  },
  { $id: 'Messages', additionalProperties: false }
)
export type Messages = Static<typeof messagesSchema>
export const messagesValidator = getValidator(messagesSchema, dataValidator)
export const messagesResolver = resolve<Messages, HookContext<MessagesService>>({
  createdAt: async () => {
    return Date.now()
  }
})

export const messagesExternalResolver = resolve<Messages, HookContext<MessagesService>>({})

// Schema for creating new entries
export const messagesDataSchema = Type.Pick(
  messagesSchema,
  ['conversationId', 'role', 'content', 'metadata', 'tokens', 'createdAt'],
  {
    $id: 'MessagesData'
  }
)
export type MessagesData = Static<typeof messagesDataSchema>
export const messagesDataValidator = getValidator(messagesDataSchema, dataValidator)
export const messagesDataResolver = resolve<MessagesData, HookContext<MessagesService>>({
  createdAt: async () => {
    return Date.now()
  }
})

// Schema for updating existing entries
export const messagesPatchSchema = Type.Partial(messagesSchema, {
  $id: 'MessagesPatch'
})
export type MessagesPatch = Static<typeof messagesPatchSchema>
export const messagesPatchValidator = getValidator(messagesPatchSchema, dataValidator)
export const messagesPatchResolver = resolve<MessagesPatch, HookContext<MessagesService>>({})

// Schema for allowed query properties
export const messagesQueryProperties = Type.Pick(messagesSchema, [
  '_id',
  'conversationId',
  'role',
  'content',
  'metadata',
  'tokens',
  'createdAt'
])
export const messagesQuerySchema = Type.Intersect(
  [
    querySyntax(messagesQueryProperties),
    // Add additional query properties here
    Type.Object({}, { additionalProperties: false })
  ],
  { additionalProperties: false }
)
export type MessagesQuery = Static<typeof messagesQuerySchema>
export const messagesQueryValidator = getValidator(messagesQuerySchema, queryValidator)
export const messagesQueryResolver = resolve<MessagesQuery, HookContext<MessagesService>>({})
