// // For more information about this file see https://dove.feathersjs.com/guides/cli/service.schemas.html
import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { EndpointsService } from './endpoints.class'

// Main data model schema
export const endpointsSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    projectId: ObjectIdSchema(),
    userId: ObjectIdSchema(),
    name: Type.String(),        
    method: Type.Union([Type.Literal('GET'), Type.Literal('POST'), Type.Literal('PUT'), Type.Literal('DELETE'), Type.Literal('PATCH')]),
    route: Type.String(),       
    code: Type.String(),        
    fileId: ObjectIdSchema(),     
    aiGenerated: Type.Boolean(),
    aiPrompt: Type.String(),                              
    createdAt: Type.Number(),
    updatedAt: Type.Number()
  },
  { $id: 'Endpoints', additionalProperties: false }
)
export type Endpoints = Static<typeof endpointsSchema>
export const endpointsValidator = getValidator(endpointsSchema, dataValidator)
export const endpointsResolver = resolve<EndpointsQuery, HookContext<EndpointsService>>({})

export const endpointsExternalResolver = resolve<Endpoints, HookContext<EndpointsService>>({})

// Schema for creating new entries
export const endpointsDataSchema = Type.Pick(endpointsSchema, ['projectId', 'userId', 'name', 'method', 'route', 'code', 'fileId', 'aiGenerated', 'aiPrompt'], {
  $id: 'EndpointsData'
})
export type EndpointsData = Static<typeof endpointsDataSchema>
export const endpointsDataValidator = getValidator(endpointsDataSchema, dataValidator)
export const endpointsDataResolver = resolve<Endpoints, HookContext<EndpointsService>>({
  createdAt: async () => {
    return Date.now()
  },
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for updating existing entries
export const endpointsPatchSchema = Type.Partial(endpointsSchema, {
  $id: 'EndpointsPatch'
})
export type EndpointsPatch = Static<typeof endpointsPatchSchema>
export const endpointsPatchValidator = getValidator(endpointsPatchSchema, dataValidator)
export const endpointsPatchResolver = resolve<EndpointsPatch, HookContext<EndpointsService>>({
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for allowed query properties
export const endpointsQueryProperties = Type.Pick(endpointsSchema, ['_id', 'projectId', 'userId', 'name', 'method', 'route', 'code', 'fileId', 'aiGenerated', 'aiPrompt'])
export const endpointsQuerySchema = Type.Intersect(
  [
    querySyntax(endpointsQueryProperties),
    // Add additional query properties here
    Type.Object({}, { additionalProperties: false })
  ],
  { additionalProperties: false }
)
export type EndpointsQuery = Static<typeof endpointsQuerySchema>
export const endpointsQueryValidator = getValidator(endpointsQuerySchema, queryValidator)
export const endpointsQueryResolver = resolve<EndpointsQuery, HookContext<EndpointsService>>({})
