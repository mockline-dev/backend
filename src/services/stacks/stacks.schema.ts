// For more information about this file see https://dove.feathersjs.com/guides/cli/service.schemas.html
import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { Type, getValidator, querySyntax } from '@feathersjs/typebox'

import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import type { StackService } from './stacks.class'

/**
 * Stack data model schema
 * Represents a technology stack configuration for the frontend
 */
export const stackSchema = Type.Object(
  {
    /** Unique identifier for this stack (e.g., 'python-fastapi') */
    id: Type.String(),
    /** Human-readable name (e.g., 'FastAPI') */
    name: Type.String(),
    /** Programming language (e.g., 'Python', 'TypeScript') */
    language: Type.String(),
    /** Framework name (e.g., 'FastAPI', 'NestJS') */
    framework: Type.String(),
    /** Description of this stack */
    description: Type.String(),
    /** Array of key features/capabilities */
    features: Type.Array(Type.String()),
    /** Optional icon URL for the stack */
    icon: Type.Optional(Type.String()),
    /** Optional color theme for the stack */
    color: Type.Optional(Type.String())
  },
  { $id: 'Stack', additionalProperties: false }
)

export type Stack = Static<typeof stackSchema>
export const stackValidator = getValidator(stackSchema, dataValidator)
export const stackResolver = resolve<Stack, HookContext<StackService>>({})
export const stackExternalResolver = resolve<Stack, HookContext<StackService>>({})

/**
 * Schema for allowed query properties
 * Stacks are read-only, so only query validation is needed
 */
export const stackQueryProperties = Type.Pick(stackSchema, ['id', 'name', 'language', 'framework'])

export const stackQuerySchema = Type.Intersect(
  [
    querySyntax(stackQueryProperties),
    // Add pagination support
    Type.Object({
      $limit: Type.Optional(Type.Number()),
      $skip: Type.Optional(Type.Number())
    })
  ],
  { additionalProperties: false }
)

export type StackQuery = Static<typeof stackQuerySchema>
export const stackQueryValidator = getValidator(stackQuerySchema, queryValidator)
export const stackQueryResolver = resolve<StackQuery, HookContext<StackService>>({})
