import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'
import { ObjectId as MongoObjectId } from 'mongodb'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { MessagesService } from './messages.class'

export const messagesSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    projectId: ObjectIdSchema(),
    role: Type.Union([
      Type.Literal('user'),
      Type.Literal('assistant'),
      Type.Literal('system'),
    ]),
    content: Type.String(),
    intent: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    metadata: Type.Optional(
      Type.Object({
        usage: Type.Optional(
          Type.Object({
            promptTokens: Type.Number(),
            completionTokens: Type.Number(),
            totalTokens: Type.Number(),
          })
        ),
        sandboxResult: Type.Optional(
          Type.Object({
            success: Type.Boolean(),
            durationMs: Type.Number(),
          })
        ),
        filesGenerated: Type.Optional(Type.Array(Type.String())),
        enhancedPrompt: Type.Optional(Type.String()),
      })
    ),
    createdAt: Type.Number(),
    updatedAt: Type.Number(),
  },
  { $id: 'Messages', additionalProperties: false }
)
export type Messages = Static<typeof messagesSchema>
export const messagesValidator = getValidator(messagesSchema, dataValidator)
export const messagesResolver = resolve<MessagesQuery, HookContext<MessagesService>>({})

export const messagesExternalResolver = resolve<Messages, HookContext<MessagesService>>({})

export const messagesDataSchema = Type.Pick(
  messagesSchema,
  ['projectId', 'role', 'content', 'intent', 'model', 'metadata'],
  { $id: 'MessagesData', additionalProperties: false }
)
export type MessagesData = Static<typeof messagesDataSchema>
export const messagesDataValidator = getValidator(messagesDataSchema, dataValidator)
export const messagesDataResolver = resolve<Messages, HookContext<MessagesService>>({
  projectId: async value => {
    if (value instanceof MongoObjectId) return value
    if (typeof value === 'string' && MongoObjectId.isValid(value)) return new MongoObjectId(value)
    return value
  },
  createdAt: async () => Date.now(),
  updatedAt: async () => Date.now(),
})

export const messagesPatchSchema = Type.Partial(messagesSchema, { $id: 'MessagesPatch' })
export type MessagesPatch = Static<typeof messagesPatchSchema>
export const messagesPatchValidator = getValidator(messagesPatchSchema, dataValidator)
export const messagesPatchResolver = resolve<MessagesPatch, HookContext<MessagesService>>({
  updatedAt: async () => Date.now(),
})

export const messagesQueryProperties = Type.Pick(messagesSchema, [
  '_id', 'projectId', 'role', 'intent', 'model', 'createdAt', 'updatedAt',
])
export const messagesQuerySchema = Type.Intersect(
  [
    querySyntax(messagesQueryProperties),
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false }
)
export type MessagesQuery = Static<typeof messagesQuerySchema>
export const messagesQueryValidator = getValidator(messagesQuerySchema, queryValidator)
export const messagesQueryResolver = resolve<MessagesQuery, HookContext<MessagesService>>({})
