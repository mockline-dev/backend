// // For more information about this file see https://dove.feathersjs.com/guides/cli/service.schemas.html
import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { ArchitectureService } from './architecture.class'

// Main data model schema
export const architectureSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    projectId: ObjectIdSchema(),
    services: Type.Array(
      Type.Object({
        name: Type.String(),
        description: Type.Optional(Type.String()),
        routes: Type.Array(Type.String()),
        methods: Type.Optional(
          Type.Array(
            Type.Object({
              name: Type.String(),
              httpMethod: Type.Optional(Type.String()),
              path: Type.Optional(Type.String()),
              params: Type.Optional(Type.Array(Type.String())),
              returnType: Type.Optional(Type.String())
            })
          )
        ),
        dependencies: Type.Optional(Type.Array(Type.String()))
      })
    ),
    models: Type.Array(
      Type.Object({
        name: Type.String(),
        fields: Type.Array(
          Type.Object({
            name: Type.String(),
            type: Type.String(),
            required: Type.Boolean(),
            indexed: Type.Optional(Type.Boolean()),
            unique: Type.Optional(Type.Boolean())
          })
        )
      })
    ),
    relations: Type.Array(
      Type.Object({
        from: Type.String(),
        to: Type.String(),
        type: Type.Union([
          Type.Literal('one-to-many'),
          Type.Literal('many-to-many'),
          Type.Literal('many-to-one'),
          Type.Literal('one-to-one')
        ])
      })
    ),
    routes: Type.Array(
      Type.Object({
        method: Type.String(),
        path: Type.String(),
        service: Type.String()
      })
    ),
    serviceDependencies: Type.Optional(
      Type.Array(
        Type.Object({
          from: Type.String(),
          to: Type.String()
        })
      )
    ),
    updatedAt: Type.Number()
  },
  { $id: 'Architecture', additionalProperties: false }
)
export type Architecture = Static<typeof architectureSchema>
export const architectureValidator = getValidator(architectureSchema, dataValidator)
export const architectureResolver = resolve<ArchitectureQuery, HookContext<ArchitectureService>>({})

export const architectureExternalResolver = resolve<Architecture, HookContext<ArchitectureService>>({})

// Schema for creating new entries
export const architectureDataSchema = Type.Pick(
  architectureSchema,
  ['projectId', 'services', 'models', 'relations', 'routes', 'updatedAt'],
  {
    $id: 'ArchitectureData'
  }
)
export type ArchitectureData = Static<typeof architectureDataSchema>
export const architectureDataValidator = getValidator(architectureDataSchema, dataValidator)
export const architectureDataResolver = resolve<ArchitectureData, HookContext<ArchitectureService>>({})

// Schema for updating existing entries
export const architecturePatchSchema = Type.Partial(architectureSchema, {
  $id: 'ArchitecturePatch'
})
export type ArchitecturePatch = Static<typeof architecturePatchSchema>
export const architecturePatchValidator = getValidator(architecturePatchSchema, dataValidator)
export const architecturePatchResolver = resolve<ArchitecturePatch, HookContext<ArchitectureService>>({})

// Schema for allowed query properties
export const architectureQueryProperties = Type.Pick(architectureSchema, ['_id', 'projectId', 'updatedAt'])
export const architectureQuerySchema = Type.Intersect(
  [
    querySyntax(architectureQueryProperties),
    // Add additional query properties here
    Type.Object({}, { additionalProperties: false })
  ],
  { additionalProperties: false }
)
export type ArchitectureQuery = Static<typeof architectureQuerySchema>
export const architectureQueryValidator = getValidator(architectureQuerySchema, queryValidator)
export const architectureQueryResolver = resolve<ArchitectureQuery, HookContext<ArchitectureService>>({})
