/**
 * Tests for TemplateEngine
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createInitializedRegistry } from '../../../agent/stacks/index'
import { TemplateEngine, createTemplateEngine } from '../template-engine'

describe('TemplateEngine', () => {
  let registry: ReturnType<typeof createInitializedRegistry>
  let engine: TemplateEngine

  beforeEach(() => {
    registry = createInitializedRegistry()
    engine = createTemplateEngine(registry)
  })

  describe('Variable Interpolation', () => {
    it('should interpolate framework variables', () => {
      const template = 'Framework: {{FRAMEWORK.name}} ({{FRAMEWORK.language}})'
      const result = engine.compile(template, 'python-fastapi', {})

      expect(result).toContain('Framework: FastAPI')
      expect(result).toContain('Python')
    })

    it('should interpolate naming conventions', () => {
      const template = 'Entity: {{NAMING.entityCase}}, Field: {{NAMING.fieldCase}}, File: {{NAMING.fileCase}}'
      const result = engine.compile(template, 'python-fastapi', {})

      expect(result).toContain('Entity: PascalCase')
      expect(result).toContain('Field: snake_case')
      expect(result).toContain('File: snake_case')
    })

    it('should interpolate structure variables', () => {
      const template = 'Package file: {{STRUCTURE.packageFile}}'
      const result = engine.compile(template, 'python-fastapi', {})

      expect(result).toContain('Package file: requirements.txt')
    })

    it('should interpolate dependency variables', () => {
      const template = 'Package manager: {{DEPENDENCIES.packageManager}}'
      const result = engine.compile(template, 'python-fastapi', {})

      expect(result).toContain('Package manager: pip')
    })

    it('should handle additional context variables', () => {
      const template = 'Project: {{PROJECT_NAME}}, Author: {{AUTHOR}}'
      const context = { PROJECT_NAME: 'MyProject', AUTHOR: 'Test Author' }
      const result = engine.compile(template, 'python-fastapi', context)

      expect(result).toContain('Project: MyProject')
      expect(result).toContain('Author: Test Author')
    })

    it('should handle missing variables gracefully', () => {
      const template = 'Framework: {{FRAMEWORK.name}}, Missing: {{MISSING_VAR}}'
      const result = engine.compile(template, 'python-fastapi', {})

      expect(result).toContain('Framework: FastAPI')
      expect(result).toContain('{{MISSING_VAR}}')
    })
  })

  describe('Stack-Specific Compilation', () => {
    it('should compile Python FastAPI template', () => {
      const template = 'Language: {{FRAMEWORK.language}}, Framework: {{FRAMEWORK.name}}'
      const result = engine.compile(template, 'python-fastapi', {})

      expect(result).toBe('Language: Python, Framework: FastAPI')
    })

    it('should compile Node.js NestJS template', () => {
      const template = 'Language: {{FRAMEWORK.language}}, Framework: {{FRAMEWORK.name}}'
      const result = engine.compile(template, 'nodejs-nestjs', {})

      expect(result).toBe('Language: TypeScript, Framework: NestJS')
    })

    it('should compile Go Gin template', () => {
      const template = 'Language: {{FRAMEWORK.language}}, Framework: {{FRAMEWORK.name}}'
      const result = engine.compile(template, 'go-gin', {})

      expect(result).toBe('Language: Go, Framework: Gin')
    })

    it('should compile Rust Actix template', () => {
      const template = 'Language: {{FRAMEWORK.language}}, Framework: {{FRAMEWORK.name}}'
      const result = engine.compile(template, 'rust-actix', {})

      expect(result).toBe('Language: Rust, Framework: Actix')
    })

    it('should compile Java Spring Boot template', () => {
      const template = 'Language: {{FRAMEWORK.language}}, Framework: {{FRAMEWORK.name}}'
      const result = engine.compile(template, 'java-springboot', {})

      expect(result).toBe('Language: Java, Framework: Spring Boot')
    })
  })

  describe('Nested Variable Access', () => {
    it('should handle deeply nested variables', () => {
      const template = 'Type system: {{TYPE_SYSTEM.primitive}}'
      const result = engine.compile(template, 'python-fastapi', {})

      expect(result).toContain('Type system:')
    })

    it('should handle multiple levels of nesting', () => {
      const template = 'Framework: {{FRAMEWORK.name}}, Language: {{FRAMEWORK.language}}'
      const result = engine.compile(template, 'python-fastapi', {})

      expect(result).toContain('Framework: FastAPI')
      expect(result).toContain('Language: Python')
    })
  })

  describe('Error Handling', () => {
    it('should throw error for non-existent stack', () => {
      const template = 'Hello, {{FRAMEWORK.name}}!'
      expect(() => engine.compile(template, 'non-existent-stack', {})).toThrow(
        'Stack not found: non-existent-stack'
      )
    })

    it('should handle empty template', () => {
      const template = ''
      const result = engine.compile(template, 'python-fastapi', {})

      expect(result).toBe('')
    })

    it('should handle template with no variables', () => {
      const template = 'Hello, World!'
      const result = engine.compile(template, 'python-fastapi', {})

      expect(result).toBe('Hello, World!')
    })
  })

  describe('Complex Templates', () => {
    it('should handle multi-line templates', () => {
      const template = `
Framework: {{FRAMEWORK.name}}
Language: {{FRAMEWORK.language}}
Package Manager: {{DEPENDENCIES.packageManager}}
      `.trim()
      const result = engine.compile(template, 'python-fastapi', {})

      expect(result).toContain('Framework: FastAPI')
      expect(result).toContain('Language: Python')
      expect(result).toContain('Package Manager: pip')
    })

    it('should handle templates with repeated variables', () => {
      const template = '{{FRAMEWORK.name}} is built with {{FRAMEWORK.name}}. {{FRAMEWORK.name}} is great!'
      const result = engine.compile(template, 'python-fastapi', {})

      expect(result).toBe('FastAPI is built with FastAPI. FastAPI is great!')
    })
  })

  describe('Cache Management', () => {
    it('should clear cache', () => {
      engine.clearCache()
      const stats = engine.getCacheStats()

      expect(stats.size).toBe(0)
    })
  })

  describe('createTemplateEngine Factory', () => {
    it('should create TemplateEngine instance', () => {
      const newEngine = createTemplateEngine(registry)

      expect(newEngine).toBeInstanceOf(TemplateEngine)
    })

    it('should create engine that works correctly', () => {
      const newEngine = createTemplateEngine(registry)
      const template = 'Framework: {{FRAMEWORK.name}}'
      const result = newEngine.compile(template, 'python-fastapi', {})

      expect(result).toBe('Framework: FastAPI')
    })
  })
})
