// Projects Service Schema
import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { ProjectsService } from './projects.class'

// Main data model schema
export const projectSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    userId: ObjectIdSchema(),
    name: Type.String(),
    description: Type.String(),
    framework: Type.String(),
    language: Type.String(),
    model: Type.String(),
    status: Type.Union([Type.Literal('initializing'), Type.Literal('generating'), Type.Literal('ready'), Type.Literal('error')]),
    createdAt: Type.Number(),
    updatedAt: Type.Number()
  },
  { $id: 'Project', additionalProperties: false }
)
export type Project = Static<typeof projectSchema>
export const projectValidator = getValidator(projectSchema, dataValidator)
export const projectResolver = resolve<Project, HookContext<ProjectsService>>({
  userId: async (_value, _project, context) => {
    return context.params.user?._id
  },
  createdAt: async () => {
    return Date.now()
  },
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for creating new entries
export const projectDataSchema = Type.Pick(
  projectSchema,
  ['name', 'description', 'framework', 'language', 'model'],
  {
    $id: 'ProjectData'
  }
)
export type ProjectData = Static<typeof projectDataSchema>
export const projectDataValidator = getValidator(projectDataSchema, dataValidator)
export const projectDataResolver = resolve<Project, HookContext<ProjectsService>>({
  createdAt: async () => {
    return Date.now()
  },
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for updating existing entries
export const projectPatchSchema = Type.Partial(projectSchema, {
  $id: 'ProjectPatch'
})
export type ProjectPatch = Static<typeof projectPatchSchema>
export const projectPatchValidator = getValidator(projectPatchSchema, dataValidator)
export const projectPatchResolver = resolve<ProjectPatch, HookContext<ProjectsService>>({
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for allowed query properties
export const projectQueryProperties = Type.Pick(projectSchema, [
  '_id',
  'userId',
  'name',
  'framework',
  'language',
  'status',
  'createdAt',
  'updatedAt'
])
export const projectQuerySchema = Type.Intersect(
  [querySyntax(projectQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false }
)
export type ProjectQuery = Static<typeof projectQuerySchema>
export const projectQueryValidator = getValidator(projectQuerySchema, queryValidator)
export const projectQueryResolver = resolve<ProjectQuery, HookContext<ProjectsService>>({
  userId: async (value, _query, context) => {
    // If user is authenticated, only show their own projects
    if (context.params.user) {
      return context.params.user._id
    }
    return value
  }
})
