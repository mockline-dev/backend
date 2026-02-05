// AI Files Service Schema
import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { AIFilesService } from './ai-files.class'

// Main data model schema
export const aiFileSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    projectId: ObjectIdSchema(),
    path: Type.String(),
    r2Key: Type.String(),
    language: Type.String(),
    size: Type.Number(),
    currentVersion: Type.Number(),
    createdAt: Type.Number(),
    updatedAt: Type.Number()
  },
  { $id: 'AIFile', additionalProperties: false }
)
export type AIFile = Static<typeof aiFileSchema>
export const aiFileValidator = getValidator(aiFileSchema, dataValidator)
export const aiFileResolver = resolve<AIFile, HookContext<AIFilesService>>({
  createdAt: async () => {
    return Date.now()
  },
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for creating new entries
export const aiFileDataSchema = Type.Pick(aiFileSchema, ['projectId', 'path', 'r2Key', 'language', 'size'], {
  $id: 'AIFileData'
})
export type AIFileData = Static<typeof aiFileDataSchema>
export const aiFileDataValidator = getValidator(aiFileDataSchema, dataValidator)
export const aiFileDataResolver = resolve<AIFile, HookContext<AIFilesService>>({
  currentVersion: async () => {
    return 1
  },
  createdAt: async () => {
    return Date.now()
  },
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for updating existing entries
export const aiFilePatchSchema = Type.Partial(aiFileSchema, {
  $id: 'AIFilePatch'
})
export type AIFilePatch = Static<typeof aiFilePatchSchema>
export const aiFilePatchValidator = getValidator(aiFilePatchSchema, dataValidator)
export const aiFilePatchResolver = resolve<AIFile, HookContext<AIFilesService>>({
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for allowed query properties
export const aiFileQueryProperties = Type.Pick(aiFileSchema, [
  '_id',
  'projectId',
  'path',
  'r2Key',
  'language',
  'currentVersion',
  'createdAt',
  'updatedAt'
])
export const aiFileQuerySchema = Type.Intersect(
  [querySyntax(aiFileQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false }
)
export type AIFileQuery = Static<typeof aiFileQuerySchema>
export const aiFileQueryValidator = getValidator(aiFileQuerySchema, queryValidator)
export const aiFileQueryResolver = resolve<AIFileQuery, HookContext<AIFilesService>>({})
