// AI File Versions Service Schema
import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { AIFileVersionsService } from './ai-file-versions.class'

// Main data model schema
export const aiFileVersionSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    fileId: ObjectIdSchema(),
    version: Type.Number(),
    r2Key: Type.String(),
    r2Bucket: Type.String(),
    changeReason: Type.String(),
    changeDescription: Type.String(),
    createdBy: ObjectIdSchema(),
    createdAt: Type.Number()
  },
  { $id: 'AIFileVersion', additionalProperties: false }
)
export type AIFileVersion = Static<typeof aiFileVersionSchema>
export const aiFileVersionValidator = getValidator(aiFileVersionSchema, dataValidator)
export const aiFileVersionResolver = resolve<AIFileVersion, HookContext<AIFileVersionsService>>({
  createdAt: async () => {
    return Date.now()
  }
})

// Schema for creating new entries
export const aiFileVersionDataSchema = Type.Pick(
  aiFileVersionSchema,
  ['fileId', 'version', 'r2Key', 'r2Bucket', 'changeReason', 'changeDescription', 'createdBy'],
  {
    $id: 'AIFileVersionData'
  }
)
export type AIFileVersionData = Static<typeof aiFileVersionDataSchema>
export const aiFileVersionDataValidator = getValidator(aiFileVersionDataSchema, dataValidator)
export const aiFileVersionDataResolver = resolve<AIFileVersion, HookContext<AIFileVersionsService>>({
  createdAt: async () => {
    return Date.now()
  }
})

// Schema for updating existing entries
export const aiFileVersionPatchSchema = Type.Partial(aiFileVersionSchema, {
  $id: 'AIFileVersionPatch'
})
export type AIFileVersionPatch = Static<typeof aiFileVersionPatchSchema>
export const aiFileVersionPatchValidator = getValidator(aiFileVersionPatchSchema, dataValidator)
export const aiFileVersionPatchResolver = resolve<AIFileVersion, HookContext<AIFileVersionsService>>({})

// Schema for allowed query properties
export const aiFileVersionQueryProperties = Type.Pick(aiFileVersionSchema, [
  '_id',
  'fileId',
  'version',
  'r2Key',
  'r2Bucket',
  'changeReason',
  'createdBy',
  'createdAt'
])
export const aiFileVersionQuerySchema = Type.Intersect(
  [querySyntax(aiFileVersionQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false }
)
export type AIFileVersionQuery = Static<typeof aiFileVersionQuerySchema>
export const aiFileVersionQueryValidator = getValidator(aiFileVersionQuerySchema, queryValidator)
export const aiFileVersionQueryResolver = resolve<AIFileVersionQuery, HookContext<AIFileVersionsService>>({})
