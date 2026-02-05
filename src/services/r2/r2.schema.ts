// R2 Service Schema
import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { R2Service } from './r2.class'

// Main data model schema
export const r2FileSchema = Type.Object(
  {
    _id: Type.String(),
    key: Type.String(),
    size: Type.Number(),
    contentType: Type.String(),
    createdAt: Type.Number(),
    updatedAt: Type.Number()
  },
  { $id: 'R2File', additionalProperties: false }
)
export type R2File = Static<typeof r2FileSchema>
export const r2FileValidator = getValidator(r2FileSchema, dataValidator)
export const r2FileResolver = resolve<R2File, HookContext<R2Service>>({})

// Schema for uploading files
export const r2UploadSchema = Type.Object(
  {
    key: Type.String(),
    content: Type.String(),
    contentType: Type.Optional(Type.String())
  },
  { $id: 'R2Upload' }
)
export type R2Upload = Static<typeof r2UploadSchema>
export const r2UploadValidator = getValidator(r2UploadSchema, dataValidator)

// Schema for presigned URL requests
export const r2PresignedUrlSchema = Type.Object(
  {
    key: Type.String(),
    expiresIn: Type.Optional(Type.Number())
  },
  { $id: 'R2PresignedUrl' }
)
export type R2PresignedUrl = Static<typeof r2PresignedUrlSchema>
export const r2PresignedUrlValidator = getValidator(r2PresignedUrlSchema, dataValidator)

// Schema for allowed query properties
export const r2QueryProperties = Type.Pick(r2FileSchema, [
  '_id',
  'key',
  'size',
  'contentType',
  'createdAt',
  'updatedAt'
])
export const r2QuerySchema = Type.Intersect(
  [querySyntax(r2QueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false }
)
export type R2Query = Static<typeof r2QuerySchema>
export const r2QueryValidator = getValidator(r2QuerySchema, queryValidator)
export const r2QueryResolver = resolve<R2Query, HookContext<R2Service>>({})
