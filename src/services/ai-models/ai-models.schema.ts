// AI Models Service Schema
import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { AIModelsService } from './ai-models.class'

// Main data model schema
export const aiModelSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    name: Type.String(),
    provider: Type.String(),
    version: Type.String(),
    enabled: Type.Boolean(),
    capabilities: Type.Array(Type.String()),
    createdAt: Type.Number(),
    updatedAt: Type.Number()
  },
  { $id: 'AIModel', additionalProperties: false }
)
export type AIModel = Static<typeof aiModelSchema>
export const aiModelValidator = getValidator(aiModelSchema, dataValidator)
export const aiModelResolver = resolve<AIModel, HookContext<AIModelsService>>({
  createdAt: async () => {
    return Date.now()
  },
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for creating new entries
export const aiModelDataSchema = Type.Pick(
  aiModelSchema,
  ['name', 'provider', 'version', 'enabled', 'capabilities'],
  {
    $id: 'AIModelData'
  }
)
export type AIModelData = Static<typeof aiModelDataSchema>
export const aiModelDataValidator = getValidator(aiModelDataSchema, dataValidator)
export const aiModelDataResolver = resolve<AIModel, HookContext<AIModelsService>>({
  createdAt: async () => {
    return Date.now()
  },
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for updating existing entries
export const aiModelPatchSchema = Type.Partial(aiModelSchema, {
  $id: 'AIModelPatch'
})
export type AIModelPatch = Static<typeof aiModelPatchSchema>
export const aiModelPatchValidator = getValidator(aiModelPatchSchema, dataValidator)
export const aiModelPatchResolver = resolve<AIModel, HookContext<AIModelsService>>({
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for allowed query properties
export const aiModelQueryProperties = Type.Pick(aiModelSchema, [
  '_id',
  'name',
  'provider',
  'version',
  'enabled',
  'capabilities',
  'createdAt',
  'updatedAt'
])
export const aiModelQuerySchema = Type.Intersect(
  [querySyntax(aiModelQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false }
)
export type AIModelQuery = Static<typeof aiModelQuerySchema>
export const aiModelQueryValidator = getValidator(aiModelQuerySchema, queryValidator)
export const aiModelQueryResolver = resolve<AIModelQuery, HookContext<AIModelsService>>({})
