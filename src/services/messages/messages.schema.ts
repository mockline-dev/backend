// Messages Service Schema
import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { MessagesService } from './messages.class'

// Main data model schema
export const messageSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    projectId: ObjectIdSchema(),
    role: Type.Union([Type.Literal('user'), Type.Literal('system'), Type.Literal('assistant')]),
    content: Type.String(),
    tokens: Type.Optional(Type.Number()),
    status: Type.Optional(Type.String()),
    createdAt: Type.Number(),
    updatedAt: Type.Number()
  },
  { $id: 'Message', additionalProperties: false }
)
export type Message = Static<typeof messageSchema>
export const messageValidator = getValidator(messageSchema, dataValidator)
export const messageResolver = resolve<Message, HookContext<MessagesService>>({})

// Schema for creating new entries
export const messageDataSchema = Type.Pick(messageSchema, ['projectId', 'role', 'content', 'tokens', 'status'], {
  $id: 'MessageData'
})
export type MessageData = Static<typeof messageDataSchema>
export const messageDataValidator = getValidator(messageDataSchema, dataValidator)
export const messageDataResolver = resolve<Message, HookContext<MessagesService>>({
  createdAt: async () => {
    return Date.now()
  },
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for updating existing entries
export const messagePatchSchema = Type.Partial(messageSchema, {
  $id: 'MessagePatch'
})
export type MessagePatch = Static<typeof messagePatchSchema>
export const messagePatchValidator = getValidator(messagePatchSchema, dataValidator)
export const messagePatchResolver = resolve<MessagePatch, HookContext<MessagesService>>({
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for allowed query properties
export const messageQueryProperties = Type.Pick(messageSchema, [
  '_id',
  'projectId',
  'role',
  'content',
  'tokens',
  'status',
  'createdAt'
])
export const messageQuerySchema = Type.Intersect(
  [querySyntax(messageQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false }
)
export type MessageQuery = Static<typeof messageQuerySchema>
export const messageQueryValidator = getValidator(messageQuerySchema, queryValidator)
export const messageQueryResolver = resolve<MessageQuery, HookContext<MessagesService>>({})
