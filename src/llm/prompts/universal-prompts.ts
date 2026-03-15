/**
 * Universal Prompt System - Universal Prompt Builder
 *
 * Builds prompts using universal templates and stack configurations.
 * Replaces the Python-specific prompt system with a language-agnostic approach.
 */

import type { IntentSchema } from '../../agent/pipeline/intent-analyzer'
import type { Relationship } from '../../agent/pipeline/schema-validator'
import { createInitializedRegistry } from '../../agent/stacks'
import type { StackConfig } from '../../agent/stacks/stack-config.types'
import { logger } from '../../logger'
import { BASE_TEMPLATES } from '../templates/base-templates'
import { TemplateEngine, createTemplateEngine } from '../templates/template-engine'

/**
 * Universal prompt builder for stack-aware code generation
 */
export class UniversalPromptBuilder {
  private templateEngine: TemplateEngine
  private stackRegistry: ReturnType<typeof createInitializedRegistry>

  constructor() {
    this.stackRegistry = createInitializedRegistry()
    this.templateEngine = createTemplateEngine(this.stackRegistry)
  }

  /**
   * Build schema extraction prompt
   * @param prompt - User's project description
   * @param stackId - Stack identifier (defaults to Python/FastAPI)
   * @returns Compiled prompt for schema extraction
   */
  buildSchemaExtractionPrompt(prompt: string, stackId: string = 'python-fastapi'): string {
    const stack = this.getStack(stackId)

    return this.templateEngine.compile(BASE_TEMPLATES.schemaExtraction, stackId, {
      prompt,
      TYPE_SYSTEM: {
        ...stack.typeSystem,
        emailType: 'str',
        phoneType: 'str',
        urlType: 'str',
        monetaryType: 'float',
        datetimeType: 'datetime',
        foreignKeyType: 'str',
        idType: 'str',
        exampleType: 'str'
      },
      NAMING: {
        ...stack.naming,
        projectCase: 'snake_case',
        entityName: 'User',
        fieldName: 'user_id'
      },
      EXAMPLES: {
        entityName: 'User',
        fieldName: 'user_id'
      }
    })
  }

  /**
   * Build file planning prompt
   * @param prompt - User's project description
   * @param schema - Extracted schema
   * @param stackId - Stack identifier (defaults to Python/FastAPI)
   * @returns Compiled prompt for file planning
   */
  buildFilePlanningPrompt(prompt: string, schema: IntentSchema, stackId: string = 'python-fastapi'): string {
    const stack = this.getStack(stackId)

    return this.templateEngine.compile(BASE_TEMPLATES.filePlanning, stackId, {
      prompt,
      schema,
      FRAMEWORK: {
        name: stack.name,
        framework: stack.framework,
        language: stack.language
      },
      STRUCTURE: {
        directories: stack.structure.directories.map(d => `   * ${d}`).join('\n'),
        packageFile: stack.structure.packageFile,
        configFiles: stack.structure.configFiles.map(f => `   * ${f}`).join('\n'),
        fileOrdering: this.buildFileOrdering(stack)
      },
      DEPENDENCIES: {
        description: `${stack.dependencies.packageManager} dependencies with version pinning`
      },
      FEATURES: {
        fileTemplates: this.buildFeatureTemplates(schema.features || [], stack)
      },
      EXAMPLES: {
        filePath: this.getExampleFilePath(stack),
        fileDescription: 'Example file description'
      }
    })
  }

  /**
   * Build file generation prompt
   * @param filePath - Path to file being generated
   * @param schema - Extracted schema
   * @param stackId - Stack identifier (defaults to Python/FastAPI)
   * @param context - Additional context (existing files, memory, relationships, RAG context)
   * @returns Compiled prompt for file generation
   */
  async buildFileGenerationPrompt(
    filePath: string,
    schema: IntentSchema,
    stackId: string = 'python-fastapi',
    context: {
      existingFiles?: Array<{ path: string; content: string }>
      memoryBlock?: string
      relationships?: Relationship[]
      ragContext?: any
    } = {}
  ): Promise<string> {
    const stack = this.getStack(stackId)

    // Build RAG context string if provided
    let ragContextString = ''
    if (context.ragContext) {
      try {
        // Import dynamically to avoid circular dependencies
        const { getWeaviateRetriever } = await import('../../agent/rag/weaviate')
        const retriever = getWeaviateRetriever()
        ragContextString = retriever.buildContextString(context.ragContext, 4000)
      } catch (error) {
        // Fallback if retriever not available
        ragContextString = ''
      }
    }

    return this.templateEngine.compile(BASE_TEMPLATES.fileGeneration, stackId, {
      filePath,
      schema,
      FRAMEWORK: {
        name: stack.name,
        framework: stack.framework,
        language: stack.language
      },
      FILE_SPECIFIC_INSTRUCTIONS: this.buildFileSpecificInstructions(filePath, stack),
      RAG_CONTEXT: ragContextString,
      ...context
    })
  }

  /**
   * Build file ordering instructions
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
   * Build feature-specific file templates
   */
  private buildFeatureTemplates(features: string[], stack: StackConfig): string {
    const featureMap: Record<string, string[]> = {
      authentication: [
        `app/api/auth.py (authentication endpoints)`,
        `app/schemas/token.py (JWT token schemas)`,
        `app/core/deps.py (dependency injection for auth)`
      ],
      'file-upload': [
        `app/utils/file_handler.py (file upload utilities)`,
        `app/api/files.py (file upload endpoints)`
      ],
      pagination: [`app/utils/pagination.py (pagination utilities)`],
      search: [`app/utils/search.py (search utilities)`],
      'soft-delete': [`app/utils/soft_delete.py (soft delete utilities)`],
      'audit-trail': [`app/utils/audit.py (audit trail utilities)`]
    }

    return features
      .filter(feature => featureMap[feature])
      .map(
        feature => `
- If "${feature}" in features:
${featureMap[feature].map(f => `   * ${f}`).join('\n')}
      `
      )
      .join('\n')
  }

  /**
   * Build file-specific instructions based on file type
   */
  private buildFileSpecificInstructions(filePath: string, stack: StackConfig): string {
    const fileType = this.classifyFileType(filePath)
    const pattern = this.getPatternForFileType(fileType, stack)

    if (!pattern || !pattern.template) {
      return ''
    }

    return `
CRITICAL for ${filePath}:
${pattern.template}

Example:
${pattern.example}
    `
  }

  /**
   * Classify file type based on path
   */
  private classifyFileType(filePath: string): string {
    const normalized = filePath.toLowerCase()

    if (normalized.includes('model') || normalized.includes('entity')) {
      return 'models'
    } else if (normalized.includes('schema') || normalized.includes('dto')) {
      return 'schemas'
    } else if (normalized.includes('service')) {
      return 'services'
    } else if (
      normalized.includes('controller') ||
      normalized.includes('router') ||
      normalized.includes('handler')
    ) {
      return 'controllers'
    } else if (normalized.includes('config')) {
      return 'config'
    } else if (normalized.includes('database') || normalized.includes('db')) {
      return 'database'
    } else if (normalized.includes('security') || normalized.includes('auth')) {
      return 'security'
    } else if (normalized.includes('main') || normalized.includes('app')) {
      return 'entry'
    } else if (normalized.includes('package') || normalized.includes('requirements')) {
      return 'dependencies'
    } else {
      return 'generic'
    }
  }

  /**
   * Get pattern for file type
   */
  private getPatternForFileType(fileType: string, stack: StackConfig): any {
    const patterns = stack.patterns as any

    switch (fileType) {
      case 'models':
        return patterns.models
      case 'schemas':
        return patterns.schemas
      case 'services':
        return patterns.services
      case 'controllers':
        return patterns.controllers
      case 'config':
        return patterns.config
      case 'database':
        return patterns.database
      case 'security':
        return patterns.security
      default:
        return null
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
   * Get stack configuration by ID
   */
  private getStack(stackId: string): StackConfig {
    const stack = this.stackRegistry.get(stackId)
    if (!stack) {
      logger.warn(`UniversalPromptBuilder: stack not found: ${stackId}, using default`)
      return this.stackRegistry.getDefault()
    }
    return stack
  }

  /**
   * Get all available stacks
   */
  getAvailableStacks(): StackConfig[] {
    return this.stackRegistry.getAll()
  }

  /**
   * Get stack by language
   */
  getStacksByLanguage(language: string): StackConfig[] {
    return this.stackRegistry.getByLanguage(language)
  }

  /**
   * Search stacks
   */
  searchStacks(query: string): StackConfig[] {
    return this.stackRegistry.search(query)
  }
}

/**
 * Create a universal prompt builder instance
 */
export function createUniversalPromptBuilder(): UniversalPromptBuilder {
  return new UniversalPromptBuilder()
}
