import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { AiConversationsService } from './ai-conversations.class'

// A single message turn stored in the conversation
const MessageSchema = Type.Object({
  role: Type.Union([
    Type.Literal('user'),
    Type.Literal('assistant'),
    Type.Literal('system'),
    Type.Literal('tool')
  ]),
  content: Type.String(),
  // Optional structured data for tool interactions
  toolCall: Type.Optional(
    Type.Object({
      name: Type.String(),
      args: Type.Any()
    })
  ),
  toolResult: Type.Optional(
    Type.Object({
      success: Type.Boolean(),
      data: Type.Optional(Type.Any()),
      error: Type.Optional(Type.String())
    })
  ),
  timestamp: Type.Optional(Type.Number())
})

export const aiConversationsSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    projectId: Type.String(),
    // Conversation messages (user + assistant turns)
    messages: Type.Array(MessageSchema),
    // Lifecycle status
    status: Type.Union([
      Type.Literal('active'),
      Type.Literal('completed'),
      Type.Literal('error')
    ]),
    // Final summary (set when done() is called by the agent)
    summary: Type.Optional(Type.String()),
    createdAt: Type.Number(),
    updatedAt: Type.Number()
  },
  { $id: 'AiConversations', additionalProperties: false }
)

export type AiConversations = Static<typeof aiConversationsSchema>
export const aiConversationsValidator = getValidator(aiConversationsSchema, dataValidator)
export const aiConversationsResolver = resolve<
  AiConversations,
  HookContext<AiConversationsService>
>({
  createdAt: async () => Date.now(),
  updatedAt: async () => Date.now()
})
export const aiConversationsExternalResolver = resolve<
  AiConversations,
  HookContext<AiConversationsService>
>({})

// Schema for creating new entries
export const aiConversationsDataSchema = Type.Pick(
  aiConversationsSchema,
  ['projectId', 'messages', 'status', 'summary'],
  { $id: 'AiConversationsData' }
)
export type AiConversationsData = Static<typeof aiConversationsDataSchema>
export const aiConversationsDataValidator = getValidator(
  aiConversationsDataSchema,
  dataValidator
)
export const aiConversationsDataResolver = resolve<
  AiConversations,
  HookContext<AiConversationsService>
>({
  createdAt: async () => Date.now(),
  updatedAt: async () => Date.now()
})

// Schema for patching existing entries
export const aiConversationsPatchSchema = Type.Partial(
  Type.Pick(aiConversationsSchema, ['messages', 'status', 'summary', 'updatedAt']),
  { $id: 'AiConversationsPatch' }
)
export type AiConversationsPatch = Static<typeof aiConversationsPatchSchema>
export const aiConversationsPatchValidator = getValidator(
  aiConversationsPatchSchema,
  dataValidator
)
export const aiConversationsPatchResolver = resolve<
  AiConversationsPatch,
  HookContext<AiConversationsService>
>({
  updatedAt: async () => Date.now()
})

// Schema for query
export const aiConversationsQueryProperties = Type.Pick(aiConversationsSchema, [
  '_id',
  'projectId',
  'status',
  'createdAt',
  'updatedAt'
])
export const aiConversationsQuerySchema = Type.Intersect(
  [
    querySyntax(aiConversationsQueryProperties),
    Type.Object({}, { additionalProperties: false })
  ],
  { additionalProperties: false }
)
export type AiConversationsQuery = Static<typeof aiConversationsQuerySchema>
export const aiConversationsQueryValidator = getValidator(
  aiConversationsQuerySchema,
  queryValidator
)
export const aiConversationsQueryResolver = resolve<
  AiConversationsQuery,
  HookContext<AiConversationsService>
>({})
