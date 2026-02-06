// Files Service Schema
import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { FilesService } from './files.class'

// Main data model schema
export const fileSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    projectId: ObjectIdSchema(),
    messageId: Type.Optional(ObjectIdSchema()),
    path: Type.String(),
    r2Key: Type.String(),
    language: Type.String(),
    size: Type.Number(),
    currentVersion: Type.Number(),
    createdAt: Type.Number(),
    updatedAt: Type.Number()
  },
  { $id: 'File', additionalProperties: false }
)
export type File = Static<typeof fileSchema>
export const fileValidator = getValidator(fileSchema, dataValidator)
export const fileResolver = resolve<File, HookContext<FilesService>>({
  createdAt: async () => {
    return Date.now()
  },
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for creating new entries
export const fileDataSchema = Type.Intersect([
  Type.Pick(fileSchema, ['projectId', 'messageId', 'path', 'r2Key', 'language', 'size']),
  Type.Object({
    content: Type.Optional(Type.String())
  })
], { $id: 'FileData' })
export type FileData = Static<typeof fileDataSchema>
export const fileDataValidator = getValidator(fileDataSchema, dataValidator)
export const fileDataResolver = resolve<File, HookContext<FilesService>>({
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
export const filePatchSchema = Type.Partial(fileSchema, {
  $id: 'FilePatch'
})
export type FilePatch = Static<typeof filePatchSchema>
export const filePatchValidator = getValidator(filePatchSchema, dataValidator)
export const filePatchResolver = resolve<FilePatch, HookContext<FilesService>>({
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for allowed query properties
export const fileQueryProperties = Type.Pick(fileSchema, [
  '_id',
  'projectId',
  'messageId',
  'path',
  'r2Key',
  'language',
  'currentVersion',
  'createdAt',
  'updatedAt'
])
export const fileQuerySchema = Type.Intersect(
  [querySyntax(fileQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false }
)
export type FileQuery = Static<typeof fileQuerySchema>
export const fileQueryValidator = getValidator(fileQuerySchema, queryValidator)
export const fileQueryResolver = resolve<FileQuery, HookContext<FilesService>>({})
