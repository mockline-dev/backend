// // For more information about this file see https://dove.feathersjs.com/guides/cli/service.schemas.html
import { resolve } from '@feathersjs/schema'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'
import type { Static } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { UploadsService } from './uploads.class'

// Main data model schema
export const uploadsSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    uri: Type.String(),
    size: Type.Number(),
    contentType: Type.String(),
    createdAt: Type.Number(),
    updatedAt: Type.Number()
  },
  { $id: 'Uploads', additionalProperties: false }
)
export type Uploads = Static<typeof uploadsSchema>
export const uploadsValidator = getValidator(uploadsSchema, dataValidator)
export const uploadsResolver = resolve<Uploads, HookContext<UploadsService>>({})

export const uploadsExternalResolver = resolve<Uploads, HookContext<UploadsService>>({})

// Schema for creating new entries
export const uploadsDataSchema = Type.Pick(uploadsSchema, ['uri', 'createdAt', 'updatedAt'], {
  $id: 'UploadsData'
})
export type UploadsData = Static<typeof uploadsDataSchema>
export const uploadsDataValidator = getValidator(uploadsDataSchema, dataValidator)
export const uploadsDataResolver = resolve<Uploads, HookContext<UploadsService>>({
  createdAt: async () => Date.now(),
  updatedAt: async () => Date.now()
})

// Schema for updating existing entries
export const uploadsPatchSchema = Type.Partial(uploadsSchema, {
  $id: 'UploadsPatch'
})
export type UploadsPatch = Static<typeof uploadsPatchSchema>
export const uploadsPatchValidator = getValidator(uploadsPatchSchema, dataValidator)
export const uploadsPatchResolver = resolve<Uploads, HookContext<UploadsService>>({
  updatedAt: async () => Date.now()
})

// Schema for allowed query properties
export const uploadsQueryProperties = Type.Pick(uploadsSchema, ['_id', 'uri'])
export const uploadsQuerySchema = Type.Intersect(
  [
    querySyntax(uploadsQueryProperties),
    // Add additional query properties here
    Type.Object({}, { additionalProperties: false })
  ],
  { additionalProperties: false }
)
export type UploadsQuery = Static<typeof uploadsQuerySchema>
export const uploadsQueryValidator = getValidator(uploadsQuerySchema, queryValidator)
export const uploadsQueryResolver = resolve<UploadsQuery, HookContext<UploadsService>>({})
