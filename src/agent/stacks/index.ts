/**
 * Universal Prompt System - Stack Configurations Index
 *
 * Exports all stack configurations and provides convenience functions
 * for working with the stack registry.
 */

import { goGinStack } from './stack-configs/go-gin'
import { javaSpringBootStack } from './stack-configs/java-springboot'
import { nodejsNestJsStack } from './stack-configs/nodejs-nestjs'
import { pythonFastApiStack } from './stack-configs/python-fastapi'
import { rustActixStack } from './stack-configs/rust-actix'
import { StackRegistry, createStackRegistry } from './stack-registry'

export type {
  CodePatterns,
  ConfigPattern,
  ControllerPattern,
  DatabasePattern,
  Dependencies,
  ErrorPattern,
  ImportPattern,
  ModelPattern,
  NamingConventions,
  PackageDefinition,
  SchemaPattern,
  SecurityPattern,
  ServicePattern,
  StackConfig,
  StackStructure,
  TestingConfig,
  TypeSystem,
  ValidationConfig
} from './stack-config.types'

export { StackRegistry, createStackRegistry }

export { goGinStack, javaSpringBootStack, nodejsNestJsStack, pythonFastApiStack, rustActixStack }

/**
 * All available stack configurations
 */
export const ALL_STACKS = [
  pythonFastApiStack,
  nodejsNestJsStack,
  goGinStack,
  rustActixStack,
  javaSpringBootStack
]

/**
 * Create and initialize a stack registry with all configurations
 */
export function createInitializedRegistry(): StackRegistry {
  const registry = createStackRegistry()
  registry.registerAll(ALL_STACKS)
  return registry
}

/**
 * Get a stack by ID from the default registry
 */
export function getStack(stackId: string) {
  const registry = createInitializedRegistry()
  return registry.get(stackId)
}

/**
 * Get all stacks from the default registry
 */
export function getAllStacks() {
  return ALL_STACKS
}

/**
 * Get stacks by language
 */
export function getStacksByLanguage(language: string) {
  const registry = createInitializedRegistry()
  return registry.getByLanguage(language)
}

/**
 * Get stacks by framework
 */
export function getStacksByFramework(framework: string) {
  const registry = createInitializedRegistry()
  return registry.getByFramework(framework)
}

/**
 * Search stacks by query
 */
export function searchStacks(query: string) {
  const registry = createInitializedRegistry()
  return registry.search(query)
}

/**
 * Get the default stack (Python/FastAPI)
 */
export function getDefaultStack() {
  const registry = createInitializedRegistry()
  return registry.getDefault()
}
