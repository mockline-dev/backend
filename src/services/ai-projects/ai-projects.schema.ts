// AI Projects Service Schema
import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { AIProjectsService } from './ai-projects.class'

// Main data model schema
export const aiProjectSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    userId: ObjectIdSchema(),
    conversationId: ObjectIdSchema(),
    name: Type.String(),
    description: Type.String(),
    framework: Type.String(),
    language: Type.String(),
    structure: Type.Object({}, { additionalProperties: true }),
    status: Type.Union([Type.Literal('generating'), Type.Literal('ready'), Type.Literal('error')]),
    createdAt: Type.Number(),
    updatedAt: Type.Number()
  },
  { $id: 'AIProject', additionalProperties: false }
)
export type AIProject = Static<typeof aiProjectSchema>
export const aiProjectValidator = getValidator(aiProjectSchema, dataValidator)
export const aiProjectResolver = resolve<AIProject, HookContext<AIProjectsService>>({
  userId: async (_value, _project, context) => {
    return context.params.user?._id
  },
  createdAt: async () => {
    return Date.now()
  },
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for creating new entries
export const aiProjectDataSchema = Type.Pick(
  aiProjectSchema,
  ['name', 'description', 'framework', 'language', 'structure', 'conversationId'],
  {
    $id: 'AIProjectData'
  }
)
export type AIProjectData = Static<typeof aiProjectDataSchema>
export const aiProjectDataValidator = getValidator(aiProjectDataSchema, dataValidator)
export const aiProjectDataResolver = resolve<AIProject, HookContext<AIProjectsService>>({
  createdAt: async () => {
    return Date.now()
  },
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for updating existing entries
export const aiProjectPatchSchema = Type.Partial(aiProjectSchema, {
  $id: 'AIProjectPatch'
})
export type AIProjectPatch = Static<typeof aiProjectPatchSchema>
export const aiProjectPatchValidator = getValidator(aiProjectPatchSchema, dataValidator)
export const aiProjectPatchResolver = resolve<AIProject, HookContext<AIProjectsService>>({
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for allowed query properties
export const aiProjectQueryProperties = Type.Pick(aiProjectSchema, [
  '_id',
  'userId',
  'conversationId',
  'name',
  'framework',
  'language',
  'status',
  'createdAt',
  'updatedAt'
])
export const aiProjectQuerySchema = Type.Intersect(
  [querySyntax(aiProjectQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false }
)
export type AIProjectQuery = Static<typeof aiProjectQuerySchema>
export const aiProjectQueryValidator = getValidator(aiProjectQuerySchema, queryValidator)
export const aiProjectQueryResolver = resolve<AIProjectQuery, HookContext<AIProjectsService>>({
  userId: async (value, _query, context) => {
    // If user is authenticated, only show their own projects
    if (context.params.user) {
      return context.params.user._id
    }
    return value
  }
})
