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
    status: Type.Union([
      Type.Literal('created'),
      Type.Literal('initializing'),
      Type.Literal('planning'),
      Type.Literal('scaffolding'),
      Type.Literal('generating'),
      Type.Literal('validating'),
      Type.Literal('editing'),
      Type.Literal('ready'),
      Type.Literal('error')
    ]),
    // Stored project plan (set by planning worker after executePlanningPipeline)
    // Type.Any() is required here — plan is an arbitrary nested JSON object (ProjectPlan)
    plan: Type.Optional(Type.Any()),
    errorMessage: Type.Optional(Type.String()),
    errorType: Type.Optional(Type.String()),
    retryAttempts: Type.Optional(Type.Number()),
    createdAt: Type.Number(),
    updatedAt: Type.Number(),
    // BullMQ job tracking
    jobId: Type.Optional(Type.String()),
    // Soft delete
    deletedAt: Type.Optional(Type.Number()),
    // Nested progress object for initial code generation
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
            failedFiles: Type.Array(Type.String()),
            fixedCount: Type.Optional(Type.Number()),
            fixedFiles: Type.Optional(Type.Array(Type.String()))
          })
        )
      })
    ),
    // Nested progress object for agentic edit jobs
    editProgress: Type.Optional(
      Type.Object({
        stage: Type.String(),
        percentage: Type.Number({ minimum: 0, maximum: 100 }),
        startedAt: Type.Optional(Type.Number()),
        completedAt: Type.Optional(Type.Number()),
        iterations: Type.Optional(Type.Number()),
        errorMessage: Type.Optional(Type.String())
      })
    )
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
    'generationProgress'
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
        failedFiles: Type.Array(Type.String()),
        fixedCount: Type.Optional(Type.Number()),
        fixedFiles: Type.Optional(Type.Array(Type.String()))
      })
    )
  })
)

const editProgressPatchSchema = Type.Partial(
  Type.Object({
    stage: Type.String(),
    percentage: Type.Number({ minimum: 0, maximum: 100 }),
    startedAt: Type.Optional(Type.Number()),
    completedAt: Type.Optional(Type.Number()),
    iterations: Type.Optional(Type.Number()),
    errorMessage: Type.Optional(Type.String())
  })
)

export const projectsPatchSchema = Type.Intersect(
  [
    Type.Partial(Type.Omit(projectsSchema, ['generationProgress', 'editProgress'])),
    Type.Object({
      generationProgress: Type.Optional(generationProgressPatchSchema),
      editProgress: Type.Optional(editProgressPatchSchema)
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
