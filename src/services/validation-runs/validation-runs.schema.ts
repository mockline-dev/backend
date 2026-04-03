import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { ObjectIdSchema, Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { ValidationRunsService } from './validation-runs.class'

const ValidationErrorSchema = Type.Object({
  file: Type.String(),
  line: Type.Optional(Type.Number()),
  message: Type.String(),
  tool: Type.Optional(Type.String())
})

export const validationRunsSchema = Type.Object(
  {
    _id: ObjectIdSchema(),
    projectId: Type.String(),
    round: Type.Number({ minimum: 1 }),
    passed: Type.Boolean(),
    errors: Type.Array(ValidationErrorSchema),
    fixesApplied: Type.Array(Type.String()),
    createdAt: Type.Number()
  },
  { $id: 'ValidationRuns', additionalProperties: false }
)

export type ValidationRuns = Static<typeof validationRunsSchema>
export const validationRunsValidator = getValidator(validationRunsSchema, dataValidator)
export const validationRunsResolver = resolve<ValidationRuns, HookContext<ValidationRunsService>>({
  createdAt: async () => Date.now()
})
export const validationRunsExternalResolver = resolve<
  ValidationRuns,
  HookContext<ValidationRunsService>
>({})

// Schema for creating new entries
export const validationRunsDataSchema = Type.Pick(
  validationRunsSchema,
  ['projectId', 'round', 'passed', 'errors', 'fixesApplied'],
  { $id: 'ValidationRunsData' }
)
export type ValidationRunsData = Static<typeof validationRunsDataSchema>
export const validationRunsDataValidator = getValidator(validationRunsDataSchema, dataValidator)
export const validationRunsDataResolver = resolve<
  ValidationRuns,
  HookContext<ValidationRunsService>
>({
  createdAt: async () => Date.now()
})

// Schema for querying
export const validationRunsQueryProperties = Type.Pick(validationRunsSchema, [
  '_id',
  'projectId',
  'round',
  'passed',
  'createdAt'
])
export const validationRunsQuerySchema = Type.Intersect(
  [
    querySyntax(validationRunsQueryProperties),
    Type.Object({}, { additionalProperties: false })
  ],
  { additionalProperties: false }
)
export type ValidationRunsQuery = Static<typeof validationRunsQuerySchema>
export const validationRunsQueryValidator = getValidator(
  validationRunsQuerySchema,
  queryValidator
)
export const validationRunsQueryResolver = resolve<
  ValidationRunsQuery,
  HookContext<ValidationRunsService>
>({})
