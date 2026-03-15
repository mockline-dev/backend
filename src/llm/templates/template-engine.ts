/**
 * Universal Prompt System - Template Engine
 *
 * Provides variable interpolation for templates with support for
 * nested variable access and stack-specific substitutions.
 */

import type { StackConfig } from '../../agent/stacks/stack-config.types'
import { logger } from '../../logger'

/**
 * Template engine for variable interpolation
 */
export class TemplateEngine {
  private templateCache: Map<string, string> = new Map()

  constructor(private stackRegistry: { get(stackId: string): StackConfig | undefined }) {}

  /**
   * Compile a template with stack-specific variables
   * @param template - Template string with {{VARIABLE}} placeholders
   * @param stackId - Stack identifier
   * @param context - Additional context variables
   * @returns Compiled template with all variables substituted
   */
  compile(template: string, stackId: string, context: Record<string, any> = {}): string {
    const stack = this.stackRegistry.get(stackId)
    if (!stack) {
      throw new Error(`Stack not found: ${stackId}`)
    }

    const variables = this.buildVariables(stack, context)
    return this.interpolate(template, variables)
  }

  /**
   * Build variable dictionary from stack configuration and context
   */
  private buildVariables(stack: StackConfig, context: Record<string, any>): Record<string, any> {
    return {
      FRAMEWORK: {
        name: stack.framework,
        language: stack.language,
        description: stack.description
      },
      TYPE_SYSTEM: {
        ...stack.typeSystem,
        ...this.extractTypeContext(context)
      },
      NAMING: {
        ...stack.naming,
        ...this.extractNamingContext(context)
      },
      STRUCTURE: {
        directories: stack.structure.directories.join('\n'),
        fileExtensions: stack.structure.fileExtensions.join(', '),
        packageFile: stack.structure.packageFile,
        configFiles: stack.structure.configFiles.join('\n'),
        fileOrdering: this.buildFileOrdering(stack)
      },
      DEPENDENCIES: {
        packageManager: stack.dependencies.packageManager,
        dependencyFile: stack.dependencies.dependencyFile,
        corePackages: this.formatPackages(stack.dependencies.corePackages),
        description: this.buildDependencyDescription(stack)
      },
      PATTERNS: stack.patterns,
      EXAMPLES: this.buildExamples(stack),
      ...context
    }
  }

  /**
   * Interpolate variables into template
   * Handles nested variable access: {{FRAMEWORK.name}}
   */
  private interpolate(template: string, variables: Record<string, any>): string {
    let result = template

    // Handle nested variable access recursively
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g')
      result = result.replace(regex, String(value))

      // Handle nested access recursively
      if (typeof value === 'object' && value !== null) {
        result = this.interpolateNested(result, key, value)
      }
    }

    return result
  }

  /**
   * Handle nested variable access (e.g., {{FRAMEWORK.name}})
   */
  private interpolateNested(template: string, prefix: string, obj: any): string {
    let result = template

    for (const [key, value] of Object.entries(obj)) {
      const nestedKey = `${prefix}.${key}`
      const regex = new RegExp(`{{${nestedKey}}}`, 'g')
      result = result.replace(regex, String(value))

      // Recursively handle deeper nesting
      if (typeof value === 'object' && value !== null) {
        result = this.interpolateNested(result, nestedKey, value)
      }
    }

    return result
  }

  /**
   * Extract type-specific context from additional context
   */
  private extractTypeContext(context: Record<string, any>): Record<string, any> {
    const typeContext: Record<string, any> = {}

    // Extract email type if present
    if (context.emailType) {
      typeContext.emailType = context.emailType
    }

    // Extract phone type if present
    if (context.phoneType) {
      typeContext.phoneType = context.phoneType
    }

    // Extract URL type if present
    if (context.urlType) {
      typeContext.urlType = context.urlType
    }

    // Extract monetary type if present
    if (context.monetaryType) {
      typeContext.monetaryType = context.monetaryType
    }

    // Extract datetime type if present
    if (context.datetimeType) {
      typeContext.datetimeType = context.datetimeType
    }

    // Extract foreign key type if present
    if (context.foreignKeyType) {
      typeContext.foreignKeyType = context.foreignKeyType
    }

    // Extract ID type if present
    if (context.idType) {
      typeContext.idType = context.idType
    }

    return typeContext
  }

  /**
   * Extract naming-specific context from additional context
   */
  private extractNamingContext(context: Record<string, any>): Record<string, any> {
    const namingContext: Record<string, any> = {}

    // Extract project name case if present
    if (context.projectNameCase) {
      namingContext.projectCase = context.projectNameCase
    }

    // Extract entity name example if present
    if (context.entityName) {
      namingContext.entityName = context.entityName
    }

    // Extract field name example if present
    if (context.fieldName) {
      namingContext.fieldName = context.fieldName
    }

    return namingContext
  }

  /**
   * Build file ordering instructions based on stack structure
   */
  private buildFileOrdering(stack: StackConfig): string {
    return `
  1. Configuration files (${stack.structure.packageFile}, ${stack.structure.configFiles.join(', ')})
  2. Core files (config, security, database)
  3. Models
  4. Schemas/DTOs
  5. Services
  6. Controllers/Routers
  7. Main application
  8. Migration files
  9. Test files
  10. Documentation
    `
  }

  /**
   * Format package definitions for display
   */
  private formatPackages(packages: Array<{ name: string; version?: string; description: string }>): string {
    return packages
      .map(pkg => {
        const version = pkg.version ? `@${pkg.version}` : ''
        return `  * ${pkg.name}${version} - ${pkg.description}`
      })
      .join('\n')
  }

  /**
   * Build dependency description
   */
  private buildDependencyDescription(stack: StackConfig): string {
    return `${stack.dependencies.packageManager} dependencies with version pinning`
  }

  /**
   * Build example values for common patterns
   */
  private buildExamples(stack: StackConfig): Record<string, any> {
    return {
      entityName: 'User',
      fieldName: stack.naming.fieldCase === 'snake_case' ? 'user_id' : 'userId',
      filePath: this.getExampleFilePath(stack),
      fileDescription: 'Example file description'
    }
  }

  /**
   * Get example file path based on stack
   */
  private getExampleFilePath(stack: StackConfig): string {
    const ext = stack.structure.fileExtensions[0] || '.py'

    switch (stack.language) {
      case 'Python':
        return `app/models/user${ext}`
      case 'TypeScript':
        return `src/modules/user/user.entity${ext}`
      case 'Go':
        return `internal/models/user${ext}`
      case 'Rust':
        return `src/models/user${ext}`
      case 'Java':
        return `src/main/java/com/example/app/model/User${ext}`
      default:
        return `models/user${ext}`
    }
  }

  /**
   * Clear template cache
   */
  clearCache(): void {
    this.templateCache.clear()
    logger.debug('TemplateEngine: cache cleared')
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number } {
    return { size: this.templateCache.size }
  }
}

/**
 * Create a template engine instance
 */
export function createTemplateEngine(stackRegistry: {
  get(stackId: string): StackConfig | undefined
}): TemplateEngine {
  return new TemplateEngine(stackRegistry)
}
