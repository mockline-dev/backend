// // For more information about this file see https://dove.feathersjs.com/guides/cli/service.schemas.html
import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'
import { ObjectId as MongoObjectId } from 'mongodb'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { FilesService } from './files.class'

// Main data model schema
export const filesSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    projectId: ObjectIdSchema(),
    messageId: Type.Optional(ObjectIdSchema()),
    name: Type.String(),
    key: Type.String(),
    fileType: Type.String(),
    size: Type.Number(),
    currentVersion: Type.Number({ default: 1 }),
    createdAt: Type.Number(),
    updatedAt: Type.Number()
  },
  { $id: 'Files', additionalProperties: false }
)
export type Files = Static<typeof filesSchema>
export const filesValidator = getValidator(filesSchema, dataValidator)
export const filesResolver = resolve<FilesQuery, HookContext<FilesService>>({})

export const filesExternalResolver = resolve<Files, HookContext<FilesService>>({})

// Schema for creating new entries
export const filesDataSchema = Type.Pick(
  filesSchema,
  ['projectId', 'messageId', 'name', 'key', 'fileType', 'size'],
  {
    $id: 'FilesData',
    additionalProperties: false
  }
)
export type FilesData = Static<typeof filesDataSchema>
export const filesDataValidator = getValidator(filesDataSchema, dataValidator)
export const filesDataResolver = resolve<Files, HookContext<FilesService>>({
  projectId: async value => {
    if (value instanceof MongoObjectId) {
      return value
    }

    if (typeof value === 'string' && MongoObjectId.isValid(value)) {
      return new MongoObjectId(value)
    }

    return value
  },
  messageId: async value => {
    if (value == null) {
      return undefined
    }

    if (value instanceof MongoObjectId) {
      return value
    }

    if (typeof value === 'string' && MongoObjectId.isValid(value)) {
      return new MongoObjectId(value)
    }

    return value
  },
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
export const filesPatchSchema = Type.Partial(filesSchema, {
  $id: 'FilesPatch'
})
export type FilesPatch = Static<typeof filesPatchSchema>
export const filesPatchValidator = getValidator(filesPatchSchema, dataValidator)
export const filesPatchResolver = resolve<FilesPatch, HookContext<FilesService>>({
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for allowed query properties
export const filesQueryProperties = Type.Pick(filesSchema, [
  '_id',
  'projectId',
  'messageId',
  'name',
  'fileType',
  'size',
  'key',
  'currentVersion',
  'createdAt',
  'updatedAt'
])
export const filesQuerySchema = Type.Intersect(
  [
    querySyntax(filesQueryProperties),
    // Add additional query properties here
    Type.Object({}, { additionalProperties: false })
  ],
  { additionalProperties: false }
)
export type FilesQuery = Static<typeof filesQuerySchema>
export const filesQueryValidator = getValidator(filesQuerySchema, queryValidator)
export const filesQueryResolver = resolve<FilesQuery, HookContext<FilesService>>({})
