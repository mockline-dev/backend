// // For more information about this file see https://dove.feathersjs.com/guides/cli/service.schemas.html
import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { SnapshotsService } from './snapshots.class'

// Main data model schema
export const snapshotsSchema = Type.Object(
  {
   _id: ObjectIdSchema(),
    projectId: ObjectIdSchema(),
    version: Type.Number(),
    label: Type.String(),
    description: Type.Optional(Type.String()),
    trigger: Type.Union([
      Type.Literal('auto-generation'),
      Type.Literal('auto-ai-edit'),
      Type.Literal('manual')
    ]),
    files: Type.Array(
      Type.Object({
        fileId: ObjectIdSchema(),
        name: Type.String(),
        key: Type.String(),
        r2SnapshotKey: Type.String(),
        size: Type.Number(),
        fileType: Type.String()
      })
    ),
    totalSize: Type.Number(),
    fileCount: Type.Number(),
    createdAt: Type.Number()
  },
  { $id: 'Snapshots', additionalProperties: false }
)
export type Snapshots = Static<typeof snapshotsSchema>
export const snapshotsValidator = getValidator(snapshotsSchema, dataValidator)
export const snapshotsResolver = resolve<SnapshotsQuery, HookContext<SnapshotsService>>({})

export const snapshotsExternalResolver = resolve<Snapshots, HookContext<SnapshotsService>>({})

// Schema for creating new entries
export const snapshotsDataSchema = Type.Pick(snapshotsSchema, ['projectId', 'version', 'label', 'description', 'trigger', 'files', 'totalSize', 'fileCount', 'createdAt'], {
  $id: 'SnapshotsData'
})
export type SnapshotsData = Static<typeof snapshotsDataSchema>
export const snapshotsDataValidator = getValidator(snapshotsDataSchema, dataValidator)
export const snapshotsDataResolver = resolve<SnapshotsData, HookContext<SnapshotsService>>({})

// Schema for updating existing entries
export const snapshotsPatchSchema = Type.Partial(snapshotsSchema, {
  $id: 'SnapshotsPatch'
})
export type SnapshotsPatch = Static<typeof snapshotsPatchSchema>
export const snapshotsPatchValidator = getValidator(snapshotsPatchSchema, dataValidator)
export const snapshotsPatchResolver = resolve<SnapshotsPatch, HookContext<SnapshotsService>>({})

// Schema for allowed query properties
export const snapshotsQueryProperties = Type.Pick(snapshotsSchema, [ '_id',
  'projectId',
  'version',
  'label',
  'trigger',
  'fileCount',
  'totalSize',
  'createdAt'
])
export const snapshotsQuerySchema = Type.Intersect(
  [
    querySyntax(snapshotsQueryProperties),
    // Add additional query properties here
    Type.Object({}, { additionalProperties: false })
  ],
  { additionalProperties: false }
)
export type SnapshotsQuery = Static<typeof snapshotsQuerySchema>
export const snapshotsQueryValidator = getValidator(snapshotsQuerySchema, queryValidator)
export const snapshotsQueryResolver = resolve<SnapshotsQuery, HookContext<SnapshotsService>>({})
