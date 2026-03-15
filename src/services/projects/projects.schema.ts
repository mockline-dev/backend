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
    framework: Type.Union([
      Type.Literal('fast-api'),
      Type.Literal('feathers'),
      Type.Literal('express'),
      Type.Literal('go-gin'),
      Type.Literal('spring-boot'),
      Type.Literal('actix'),
      Type.Literal('nestjs')
    ]),
    language: Type.Union([
      Type.Literal('python'),
      Type.Literal('typescript'),
      Type.Literal('go'),
      Type.Literal('java'),
      Type.Literal('rust')
    ]),
    model: Type.String(),
    status: Type.Union([
      Type.Literal('initializing'),
      Type.Literal('generating'),
      Type.Literal('validating'),
      Type.Literal('ready'),
      Type.Literal('error')
    ]),
    errorMessage: Type.Optional(Type.String()),
    errorType: Type.Optional(Type.String()),
    retryAttempts: Type.Optional(Type.Number()),
    createdAt: Type.Number(),
    updatedAt: Type.Number(),
    // BullMQ job tracking
    jobId: Type.Optional(Type.String()),
    // Architecture reference
    architectureId: Type.Optional(ObjectIdSchema()),
    // Soft delete
    deletedAt: Type.Optional(Type.Number()),
    // Nested progress object
    generationProgress: Type.Optional(
      Type.Object({
        percentage: Type.Number({ minimum: 0, maximum: 100, default: 0 }),
        currentStage: Type.String({ default: '' }),
        currentFile: Type.Optional(Type.String()),
        filesGenerated: Type.Number({ default: 0 }),
        totalFiles: Type.Number({ default: 0 }),
        startedAt: Type.Optional(Type.Number()),
        completedAt: Type.Optional(Type.Number()),
        failedAt: Type.Optional(Type.Number()),
        errorMessage: Type.Optional(Type.String()),
        warnings: Type.Optional(Type.Array(Type.String())),
        errorType: Type.Optional(Type.String()),
        retryAttempts: Type.Optional(Type.Number()),
        validationResults: Type.Optional(
          Type.Object({
            passCount: Type.Number(),
            failCount: Type.Number(),
            failedFiles: Type.Array(Type.String())
          })
        )
      })
    )
  },
  { $id: 'Projects', additionalProperties: false }
)
export type Projects = Static<typeof projectsSchema>
export const projectsValidator = getValidator(projectsSchema, dataValidator)
export const projectsResolver = resolve<Projects, HookContext<ProjectsService>>({
  createdAt: async () => {
    return Date.now()
  },
  updatedAt: async () => {
    return Date.now()
  }
})

export const projectsExternalResolver = resolve<Projects, HookContext<ProjectsService>>({})

// Schema for creating new entries
export const projectsDataSchema = Type.Pick(
  projectsSchema,
  [
    'userId',
    'name',
    'description',
    'framework',
    'language',
    'model',
    'status',
    'jobId',
    'generationProgress',
    'architectureId'
  ],
  {
    $id: 'ProjectsData'
  }
)
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
const generationProgressPatchSchema = Type.Partial(
  Type.Object({
    percentage: Type.Number({ minimum: 0, maximum: 100, default: 0 }),
    currentStage: Type.String({ default: '' }),
    currentFile: Type.Optional(Type.String()),
    filesGenerated: Type.Number({ default: 0 }),
    totalFiles: Type.Number({ default: 0 }),
    startedAt: Type.Optional(Type.Number()),
    completedAt: Type.Optional(Type.Number()),
    failedAt: Type.Optional(Type.Number()),
    errorMessage: Type.Optional(Type.String()),
    warnings: Type.Optional(Type.Array(Type.String())),
    errorType: Type.Optional(Type.String()),
    retryAttempts: Type.Optional(Type.Number()),
    validationResults: Type.Optional(
      Type.Object({
        passCount: Type.Number(),
        failCount: Type.Number(),
        failedFiles: Type.Array(Type.String())
      })
    )
  })
)

export const projectsPatchSchema = Type.Intersect(
  [
    Type.Partial(Type.Omit(projectsSchema, ['generationProgress'])),
    Type.Object({
      generationProgress: Type.Optional(generationProgressPatchSchema)
    })
  ],
  {
    $id: 'ProjectsPatch',
    additionalProperties: false
  }
)
export type ProjectsPatch = Static<typeof projectsPatchSchema>
export const projectsPatchValidator = getValidator(projectsPatchSchema, dataValidator)
export const projectsPatchResolver = resolve<ProjectsPatch, HookContext<ProjectsService>>({
  updatedAt: async () => {
    return Date.now()
  }
})

// Schema for allowed query properties
export const projectsQueryProperties = Type.Pick(projectsSchema, [
  '_id',
  'userId',
  'name',
  'description',
  'framework',
  'language',
  'model',
  'status',
  'errorMessage',
  'createdAt',
  'updatedAt',
  'jobId',
  'architectureId',
  'deletedAt'
])
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
