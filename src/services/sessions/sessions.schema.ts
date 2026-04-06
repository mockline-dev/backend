import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'
import { ObjectId as MongoObjectId } from 'mongodb'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { SessionsService } from './sessions.class'

export const sessionsSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    projectId: ObjectIdSchema(),
    userId: ObjectIdSchema(),
    status: Type.Union([
      Type.Literal('starting'),
      Type.Literal('running'),
      Type.Literal('stopped'),
      Type.Literal('error'),
    ]),
    containerId: Type.Optional(Type.String()),
    proxyUrl: Type.Optional(Type.String()),
    port: Type.Optional(Type.Number()),
    language: Type.String(),
    startedAt: Type.Optional(Type.Number()),
    stoppedAt: Type.Optional(Type.Number()),
    errorMessage: Type.Optional(Type.String()),
    createdAt: Type.Number(),
    updatedAt: Type.Number(),
  },
  { $id: 'Sessions', additionalProperties: false }
)
export type Sessions = Static<typeof sessionsSchema>
export const sessionsValidator = getValidator(sessionsSchema, dataValidator)
export const sessionsResolver = resolve<SessionsQuery, HookContext<SessionsService>>({})

export const sessionsExternalResolver = resolve<Sessions, HookContext<SessionsService>>({})

export const sessionsDataSchema = Type.Pick(
  sessionsSchema,
  ['projectId', 'userId', 'language'],
  { $id: 'SessionsData', additionalProperties: false }
)
export type SessionsData = Static<typeof sessionsDataSchema>
export const sessionsDataValidator = getValidator(sessionsDataSchema, dataValidator)
export const sessionsDataResolver = resolve<Sessions, HookContext<SessionsService>>({
  projectId: async value => {
    if (value instanceof MongoObjectId) return value
    if (typeof value === 'string' && MongoObjectId.isValid(value)) return new MongoObjectId(value)
    return value
  },
  userId: async value => {
    if (value instanceof MongoObjectId) return value
    if (typeof value === 'string' && MongoObjectId.isValid(value)) return new MongoObjectId(value)
    return value
  },
  status: async () => 'starting' as const,
  createdAt: async () => Date.now(),
  updatedAt: async () => Date.now(),
})

export const sessionsPatchSchema = Type.Partial(sessionsSchema, { $id: 'SessionsPatch' })
export type SessionsPatch = Static<typeof sessionsPatchSchema>
export const sessionsPatchValidator = getValidator(sessionsPatchSchema, dataValidator)
export const sessionsPatchResolver = resolve<SessionsPatch, HookContext<SessionsService>>({
  updatedAt: async () => Date.now(),
})

export const sessionsQueryProperties = Type.Pick(sessionsSchema, [
  '_id', 'projectId', 'userId', 'status', 'language', 'createdAt', 'updatedAt',
])
export const sessionsQuerySchema = Type.Intersect(
  [
    querySyntax(sessionsQueryProperties),
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false }
)
export type SessionsQuery = Static<typeof sessionsQuerySchema>
export const sessionsQueryValidator = getValidator(sessionsQuerySchema, queryValidator)
export const sessionsQueryResolver = resolve<SessionsQuery, HookContext<SessionsService>>({})
