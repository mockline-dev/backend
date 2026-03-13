// For more information about this file see https://dove.feathersjs.com/guides/cli/service.schemas.html
import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { ModelsService } from './models.class'

export const modelsSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    /** Human-friendly label, e.g. "Qwen 2.5 Coder 7B" */
    name: Type.String(),
    /** Provider identifier: "ollama" | "openai" | "anthropic" */
    provider: Type.String(),
    /** The model slug passed to the provider, e.g. "qwen2.5-coder:7b" */
    model: Type.String(),
    /** Base URL for the provider endpoint (optional for cloud providers) */
    baseUrl: Type.Optional(Type.String()),
    /** Whether this model is the active default for new projects */
    isDefault: Type.Boolean({ default: false }),
    /** Supported capabilities */
    capabilities: Type.Object(
      {
        chat: Type.Boolean({ default: true }),
        embed: Type.Boolean({ default: false }),
        tools: Type.Boolean({ default: false })
      },
      { additionalProperties: false }
    ),
    createdAt: Type.Number(),
    updatedAt: Type.Number()
  },
  { $id: 'Models', additionalProperties: false }
)
export type Models = Static<typeof modelsSchema>
export const modelsValidator = getValidator(modelsSchema, dataValidator)
export const modelsResolver = resolve<Models, HookContext<ModelsService>>({})
export const modelsExternalResolver = resolve<Models, HookContext<ModelsService>>({})

// Schema for creating new entries
export const modelsDataSchema = Type.Pick(
  modelsSchema,
  ['name', 'provider', 'model', 'baseUrl', 'isDefault', 'capabilities'],
  { $id: 'ModelsData' }
)
export type ModelsData = Static<typeof modelsDataSchema>
export const modelsDataValidator = getValidator(modelsDataSchema, dataValidator)
export const modelsDataResolver = resolve<Models, HookContext<ModelsService>>({
  createdAt: async () => Date.now(),
  updatedAt: async () => Date.now()
})

// Schema for updating existing entries
export const modelsPatchSchema = Type.Partial(modelsSchema, { $id: 'ModelsPatch' })
export type ModelsPatch = Static<typeof modelsPatchSchema>
export const modelsPatchValidator = getValidator(modelsPatchSchema, dataValidator)
export const modelsPatchResolver = resolve<ModelsPatch, HookContext<ModelsService>>({
  updatedAt: async () => Date.now()
})

// Schema for allowed query properties
export const modelsQueryProperties = Type.Pick(modelsSchema, [
  '_id',
  'name',
  'provider',
  'model',
  'isDefault'
])
export const modelsQuerySchema = Type.Intersect(
  [querySyntax(modelsQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false }
)
export type ModelsQuery = Static<typeof modelsQuerySchema>
export const modelsQueryValidator = getValidator(modelsQuerySchema, queryValidator)
export const modelsQueryResolver = resolve<ModelsQuery, HookContext<ModelsService>>({})
