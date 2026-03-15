/**
 * Tests for StackRegistry
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createInitializedRegistry } from '../index'
import { StackRegistry } from '../stack-registry'

describe('StackRegistry', () => {
  let registry: StackRegistry

  beforeEach(() => {
    registry = new StackRegistry()
  })

  describe('Initialization', () => {
    it('should create initialized registry with all stacks', () => {
      const initializedRegistry = createInitializedRegistry()
      const allStacks = initializedRegistry.getAll()

      expect(allStacks.length).toBeGreaterThan(0)
      expect(allStacks.every(stack => stack.id)).toBeTruthy()
    })

    it('should have all required stacks registered', () => {
      const initializedRegistry = createInitializedRegistry()
      const stackIds = initializedRegistry.getAll().map(s => s.id)

      expect(stackIds).toContain('python-fastapi')
      expect(stackIds).toContain('nodejs-nestjs')
      expect(stackIds).toContain('go-gin')
      expect(stackIds).toContain('rust-actix')
      expect(stackIds).toContain('java-springboot')
    })
  })

  describe('Retrieval', () => {
    it('should retrieve Python FastAPI stack', () => {
      const initializedRegistry = createInitializedRegistry()
      const stack = initializedRegistry.get('python-fastapi')

      expect(stack).toBeDefined()
      expect(stack?.id).toBe('python-fastapi')
      expect(stack?.language).toBe('Python')
      expect(stack?.framework).toBe('FastAPI')
    })

    it('should retrieve Node.js NestJS stack', () => {
      const initializedRegistry = createInitializedRegistry()
      const stack = initializedRegistry.get('nodejs-nestjs')

      expect(stack).toBeDefined()
      expect(stack?.id).toBe('nodejs-nestjs')
      expect(stack?.language).toBe('TypeScript')
      expect(stack?.framework).toBe('NestJS')
    })

    it('should retrieve Go Gin stack', () => {
      const initializedRegistry = createInitializedRegistry()
      const stack = initializedRegistry.get('go-gin')

      expect(stack).toBeDefined()
      expect(stack?.id).toBe('go-gin')
      expect(stack?.language).toBe('Go')
      expect(stack?.framework).toBe('Gin')
    })

    it('should retrieve Rust Actix stack', () => {
      const initializedRegistry = createInitializedRegistry()
      const stack = initializedRegistry.get('rust-actix')

      expect(stack).toBeDefined()
      expect(stack?.id).toBe('rust-actix')
      expect(stack?.language).toBe('Rust')
      expect(stack?.framework).toBe('Actix')
    })

    it('should retrieve Java Spring Boot stack', () => {
      const initializedRegistry = createInitializedRegistry()
      const stack = initializedRegistry.get('java-springboot')

      expect(stack).toBeDefined()
      expect(stack?.id).toBe('java-springboot')
      expect(stack?.language).toBe('Java')
      expect(stack?.framework).toBe('Spring Boot')
    })

    it('should return undefined for non-existent stack', () => {
      const initializedRegistry = createInitializedRegistry()
      const result = initializedRegistry.get('non-existent')
      expect(result).toBeUndefined()
    })
  })

  describe('Filtering', () => {
    it('should get stacks by language', () => {
      const initializedRegistry = createInitializedRegistry()

      const pythonStacks = initializedRegistry.getByLanguage('Python')
      expect(pythonStacks).toHaveLength(1)
      expect(pythonStacks[0].id).toBe('python-fastapi')

      const tsStacks = initializedRegistry.getByLanguage('TypeScript')
      expect(tsStacks).toHaveLength(1)
      expect(tsStacks[0].id).toBe('nodejs-nestjs')

      const goStacks = initializedRegistry.getByLanguage('Go')
      expect(goStacks).toHaveLength(1)
      expect(goStacks[0].id).toBe('go-gin')

      const rustStacks = initializedRegistry.getByLanguage('Rust')
      expect(rustStacks).toHaveLength(1)
      expect(rustStacks[0].id).toBe('rust-actix')

      const javaStacks = initializedRegistry.getByLanguage('Java')
      expect(javaStacks).toHaveLength(1)
      expect(javaStacks[0].id).toBe('java-springboot')
    })

    it('should get stacks by framework', () => {
      const initializedRegistry = createInitializedRegistry()

      const fastapiStacks = initializedRegistry.getByFramework('FastAPI')
      expect(fastapiStacks).toHaveLength(1)
      expect(fastapiStacks[0].id).toBe('python-fastapi')

      const nestjsStacks = initializedRegistry.getByFramework('NestJS')
      expect(nestjsStacks).toHaveLength(1)
      expect(nestjsStacks[0].id).toBe('nodejs-nestjs')

      const ginStacks = initializedRegistry.getByFramework('Gin')
      expect(ginStacks).toHaveLength(1)
      expect(ginStacks[0].id).toBe('go-gin')

      const actixStacks = initializedRegistry.getByFramework('Actix')
      expect(actixStacks).toHaveLength(1)
      expect(actixStacks[0].id).toBe('rust-actix')

      const springStacks = initializedRegistry.getByFramework('Spring Boot')
      expect(springStacks).toHaveLength(1)
      expect(springStacks[0].id).toBe('java-springboot')
    })
  })

  describe('Search', () => {
    it('should search stacks by query', () => {
      const initializedRegistry = createInitializedRegistry()

      const pythonResults = initializedRegistry.search('python')
      expect(pythonResults.length).toBeGreaterThan(0)
      expect(pythonResults.some(s => s.id === 'python-fastapi')).toBe(true)

      const nestResults = initializedRegistry.search('nest')
      expect(nestResults.length).toBeGreaterThan(0)
      expect(nestResults.some(s => s.id === 'nodejs-nestjs')).toBe(true)

      const apiResults = initializedRegistry.search('api')
      expect(apiResults.length).toBeGreaterThan(0)
      expect(apiResults.some(s => s.id === 'python-fastapi')).toBe(true)
    })

    it('should return empty array for non-matching search', () => {
      const initializedRegistry = createInitializedRegistry()
      const results = initializedRegistry.search('nonexistent')
      expect(results).toEqual([])
    })
  })

  describe('Default Stack', () => {
    it('should set and get default stack', () => {
      const initializedRegistry = createInitializedRegistry()
      initializedRegistry.setDefault('python-fastapi')
      const defaultStack = initializedRegistry.getDefault()

      expect(defaultStack).toBeDefined()
      expect(defaultStack?.id).toBe('python-fastapi')
    })

    it('should throw error when setting non-existent stack as default', () => {
      const initializedRegistry = createInitializedRegistry()
      expect(() => initializedRegistry.setDefault('non-existent')).toThrow(
        'Cannot set non-existent stack "non-existent" as default'
      )
    })
  })

  describe('Stack Configuration Validation', () => {
    it('should validate Python FastAPI stack configuration', () => {
      const initializedRegistry = createInitializedRegistry()
      const stack = initializedRegistry.get('python-fastapi')

      expect(stack).toBeDefined()
      expect(stack?.typeSystem).toBeDefined()
      expect(stack?.typeSystem.primitiveTypes).toBeDefined()
      expect(Object.keys(stack?.typeSystem.primitiveTypes || {}).length).toBeGreaterThan(0)

      expect(stack?.naming).toBeDefined()
      expect(stack?.naming.entityCase).toBe('PascalCase')
      expect(stack?.naming.fieldCase).toBe('snake_case')
      expect(stack?.naming.fileCase).toBe('snake_case')

      expect(stack?.structure).toBeDefined()
      expect(stack?.structure.directories.length).toBeGreaterThan(0)
      expect(stack?.structure.fileExtensions.length).toBeGreaterThan(0)

      expect(stack?.dependencies).toBeDefined()
      expect(stack?.dependencies.packageManager).toBe('pip')
      expect(stack?.dependencies.corePackages.length).toBeGreaterThan(0)

      expect(stack?.patterns).toBeDefined()
      expect(stack?.patterns.models).toBeDefined()
      expect(stack?.patterns.schemas).toBeDefined()
      expect(stack?.patterns.services).toBeDefined()
      expect(stack?.patterns.controllers).toBeDefined()

      expect(stack?.validation).toBeDefined()
      expect(stack?.validation.linter).toBe('ruff')

      expect(stack?.testing).toBeDefined()
      expect(stack?.testing.framework).toBe('pytest')
    })

    it('should validate Node.js NestJS stack configuration', () => {
      const initializedRegistry = createInitializedRegistry()
      const stack = initializedRegistry.get('nodejs-nestjs')

      expect(stack).toBeDefined()
      expect(stack?.language).toBe('TypeScript')
      expect(stack?.framework).toBe('NestJS')
      expect(stack?.dependencies.packageManager).toBe('npm')
      expect(stack?.validation.linter).toBe('eslint')
      expect(stack?.testing.framework).toBe('jest')
    })

    it('should validate Go Gin stack configuration', () => {
      const initializedRegistry = createInitializedRegistry()
      const stack = initializedRegistry.get('go-gin')

      expect(stack).toBeDefined()
      expect(stack?.language).toBe('Go')
      expect(stack?.framework).toBe('Gin')
      expect(stack?.dependencies.packageManager).toBe('go get')
      expect(stack?.validation.linter).toBe('golangci-lint')
      expect(stack?.testing.framework).toBe('go test')
    })

    it('should validate Rust Actix stack configuration', () => {
      const initializedRegistry = createInitializedRegistry()
      const stack = initializedRegistry.get('rust-actix')

      expect(stack).toBeDefined()
      expect(stack?.language).toBe('Rust')
      expect(stack?.framework).toBe('Actix')
      expect(stack?.dependencies.packageManager).toBe('cargo')
      expect(stack?.validation.linter).toBe('clippy')
      expect(stack?.testing.framework).toBe('cargo test')
    })

    it('should validate Java Spring Boot stack configuration', () => {
      const initializedRegistry = createInitializedRegistry()
      const stack = initializedRegistry.get('java-springboot')

      expect(stack).toBeDefined()
      expect(stack?.language).toBe('Java')
      expect(stack?.framework).toBe('Spring Boot')
      expect(stack?.dependencies.packageManager).toBe('maven')
      expect(stack?.validation.linter).toBe('checkstyle')
      expect(stack?.testing.framework).toBe('JUnit')
    })
  })
})
