// // For more information about this file see https://dove.feathersjs.com/guides/cli/service.schemas.html
import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { ProjectsService } from './projects.class'

// Main data model schema
export const projectsSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    userId: ObjectIdSchema(),
    name: Type.String(),
    description: Type.String(),
    framework: Type.Union([Type.Literal('fast-api'), Type.Literal('feathers')]),
    language: Type.Union([Type.Literal('python'), Type.Literal('typescript')]),
    model: Type.String(),
    status: Type.Union([Type.Literal('initializing'), Type.Literal('generating'), Type.Literal('ready'), Type.Literal('error')]),
    errorMessage: Type.Optional(Type.String()),
    createdAt: Type.Number(),
    updatedAt: Type.Number()
  },
  { $id: 'Projects', additionalProperties: false }
)
export type Projects = Static<typeof projectsSchema>
export const projectsValidator = getValidator(projectsSchema, dataValidator)
export const projectsResolver = resolve<ProjectsQuery, HookContext<ProjectsService>>({
  createdAt: async () => {
    return Date.now()
  },
  updatedAt: async () => {
    return Date.now()
  }
})

export const projectsExternalResolver = resolve<Projects, HookContext<ProjectsService>>({})

// Schema for creating new entries
export const projectsDataSchema = Type.Pick(projectsSchema, ['userId', 'name', 'description', 'framework', 'language', 'model', 'status', 'errorMessage'], {
  $id: 'ProjectsData'
})
export type ProjectsData = Static<typeof projectsDataSchema>
export const projectsDataValidator = getValidator(projectsDataSchema, dataValidator)
export const projectsDataResolver = resolve<Projects, HookContext<ProjectsService>>({
   createdAt: async () => {
    return Date.now()
  },
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for updating existing entries
export const projectsPatchSchema = Type.Partial(projectsSchema, {
  $id: 'ProjectsPatch'
})
export type ProjectsPatch = Static<typeof projectsPatchSchema>
export const projectsPatchValidator = getValidator(projectsPatchSchema, dataValidator)
export const projectsPatchResolver = resolve<ProjectsPatch, HookContext<ProjectsService>>({
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for allowed query properties
export const projectsQueryProperties = Type.Pick(projectsSchema, ['_id', 'userId', 'name', 'description', 'framework', 'language', 'model', 'status', 'errorMessage', 'createdAt', 'updatedAt'])
export const projectsQuerySchema = Type.Intersect(
  [
    querySyntax(projectsQueryProperties),
    // Add additional query properties here
    Type.Object({}, { additionalProperties: false })
  ],
  { additionalProperties: false }
)
export type ProjectsQuery = Static<typeof projectsQuerySchema>
export const projectsQueryValidator = getValidator(projectsQuerySchema, queryValidator)
export const projectsQueryResolver = resolve<ProjectsQuery, HookContext<ProjectsService>>({})
