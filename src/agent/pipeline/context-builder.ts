import { logger } from '../../logger'
import type { DependencyGraph } from './dependency-analyzer'
import type { IntentSchema } from './intent-analyzer'
import type { Relationship } from './schema-validator'
import type { TaskPlan } from './task-planner'

export interface FileContext {
  path: string
  dependencies: string[] // Files this file depends on
  dependents: string[] // Files that depend on this file
  importsNeeded: string[] // Required imports
  exportsProvided: string[] // What this file exports
  relationships: Relationship[] // Relevant relationships
  entityName?: string // Associated entity name (if applicable)
  fileType: 'config' | 'model' | 'schema' | 'service' | 'api' | 'main' | 'test' | 'other'
}

/**
 * Builds comprehensive context for each file before generation starts.
 * Provides global context that can be reused across all file generations.
 */
export class ContextBuilder {
  /**
   * Builds global context for all files in the plan.
   * Returns a map of file path to context.
   */
  buildGlobalContext(
    plan: TaskPlan[],
    schema: IntentSchema,
    relationships: Relationship[],
    graph: DependencyGraph
  ): Map<string, FileContext> {
    logger.debug('ContextBuilder: building global context for %d files', plan.length)

    const contexts = new Map<string, FileContext>()

    // Build context for each file
    for (const task of plan) {
      const context = this.buildContextForFile(task, plan, schema, relationships, graph)
      contexts.set(task.path, context)
    }

    logger.debug('ContextBuilder: built context for %d files', contexts.size)
    return contexts
  }

  /**
   * Builds context for a specific file.
   */
  private buildContextForFile(
    file: TaskPlan,
    allFiles: TaskPlan[],
    schema: IntentSchema,
    relationships: Relationship[],
    graph: DependencyGraph
  ): FileContext {
    const node = graph.nodes.get(file.path)

    if (!node) {
      logger.warn('ContextBuilder: no dependency node found for %s', file.path)
    }

    const fileType = this.classifyFileType(file.path)
    const entityName = this.extractEntityName(file.path, fileType)

    // Get dependencies and dependents from graph
    const dependencies = node?.dependencies || []
    const dependents = node?.dependents || []

    // Calculate required imports
    const importsNeeded = this.calculateImports(file, fileType, entityName, schema, relationships)

    // Calculate exports provided
    const exportsProvided = this.calculateExports(file, fileType, entityName, schema)

    // Get relevant relationships
    const relevantRelationships = this.getRelevantRelationships(entityName, relationships, schema)

    return {
      path: file.path,
      dependencies,
      dependents,
      importsNeeded,
      exportsProvided,
      relationships: relevantRelationships,
      entityName,
      fileType
    }
  }

  /**
   * Classifies the type of file based on its path.
   */
  private classifyFileType(path: string): FileContext['fileType'] {
    const normalized = path.toLowerCase()

    if (
      normalized === 'requirements.txt' ||
      normalized === '.env.example' ||
      normalized === 'alembic.ini' ||
      normalized === 'readme.md'
    ) {
      return 'config'
    }

    if (normalized.startsWith('app/core/')) {
      return 'config'
    }

    if (normalized.startsWith('app/models/')) {
      return 'model'
    }

    if (normalized.startsWith('app/schemas/')) {
      return 'schema'
    }

    if (normalized.startsWith('app/services/') || normalized.startsWith('app/utils/')) {
      return 'service'
    }

    if (normalized.startsWith('app/api/')) {
      return 'api'
    }

    if (normalized === 'main.py' || normalized.startsWith('app/__')) {
      return 'main'
    }

    if (normalized.startsWith('tests/')) {
      return 'test'
    }

    return 'other'
  }

  /**
   * Extracts entity name from file path.
   */
  private extractEntityName(path: string, fileType: FileContext['fileType']): string | undefined {
    if (fileType !== 'model' && fileType !== 'schema' && fileType !== 'service' && fileType !== 'api') {
      return undefined
    }

    const parts = path.split('/')
    const filename = parts[parts.length - 1] || ''
    return filename.replace('.py', '').toLowerCase()
  }

  /**
   * Calculates required imports for a file.
   * NOTE: Only suggests project-local imports (app.*). Standard library and third-party
   * imports are handled by the LLM based on code patterns.
   */
  private calculateImports(
    file: TaskPlan,
    fileType: FileContext['fileType'],
    entityName: string | undefined,
    schema: IntentSchema,
    relationships: Relationship[]
  ): string[] {
    const imports: string[] = []

    // Only suggest project-local imports (app.*)
    // Standard library and third-party imports are NOT suggested here
    // The LLM will add them based on the code it generates

    switch (fileType) {
      case 'model':
        // Only suggest project-local model imports for relationships
        if (entityName) {
          const entity = schema.entities.find(e => e.name.toLowerCase() === entityName)
          if (entity) {
            for (const field of entity.fields) {
              const fieldLower = field.name.toLowerCase()
              for (const otherEntity of schema.entities) {
                if (otherEntity.name.toLowerCase() === entityName) continue

                const otherEntityLower = otherEntity.name.toLowerCase()
                if (
                  fieldLower === `${otherEntityLower}id` ||
                  fieldLower === `${otherEntityLower}_id` ||
                  fieldLower.startsWith(`${otherEntityLower}_`)
                ) {
                  imports.push(`from app.models.${otherEntityLower} import ${otherEntity.name}`)
                }
              }
            }
          }
        }
        break

      case 'schema':
        // Only suggest project-local model imports
        if (entityName) {
          imports.push(`from app.models.${entityName} import ${this.capitalize(entityName)}`)
        }
        break

      case 'service':
        // Only suggest project-local imports
        if (entityName) {
          const capitalizedName = this.capitalize(entityName)
          imports.push(`from app.models.${entityName} import ${capitalizedName}`)
          imports.push(
            `from app.schemas.${entityName} import ${capitalizedName}Create, ${capitalizedName}Update, ${capitalizedName}Response`
          )
        }
        break

      case 'api':
        // Only suggest project-local imports
        if (entityName) {
          const capitalizedName = this.capitalize(entityName)
          imports.push(`from app.models.${entityName} import ${capitalizedName}`)
          imports.push(
            `from app.schemas.${entityName} import ${capitalizedName}Create, ${capitalizedName}Update, ${capitalizedName}Response`
          )
          imports.push(`from app.services.${entityName} import ${capitalizedName}Service`)
          imports.push('from app.core.deps import get_db')
        }

        // Auth API specific imports
        if (file.path.includes('auth.py')) {
          imports.push('from app.core.security import verify_password, create_access_token')
          imports.push('from app.core.deps import get_current_user')
        }
        break

      case 'config':
        // No project-local imports needed for config files
        break

      case 'main':
        // No project-local imports needed for main file
        break

      case 'test':
        // No project-local imports needed for test files
        break
    }

    // Remove duplicates while preserving order
    return Array.from(new Set(imports))
  }

  /**
   * Calculates exports provided by a file.
   */
  private calculateExports(
    file: TaskPlan,
    fileType: FileContext['fileType'],
    entityName: string | undefined,
    schema: IntentSchema
  ): string[] {
    const exports: string[] = []

    if (entityName) {
      const capitalizedName = this.capitalize(entityName)

      switch (fileType) {
        case 'model':
          exports.push(capitalizedName)
          break

        case 'schema':
          exports.push(
            `${capitalizedName}Base`,
            `${capitalizedName}Create`,
            `${capitalizedName}Update`,
            `${capitalizedName}Response`,
            `${capitalizedName}List`
          )
          break

        case 'service':
          exports.push(`${capitalizedName}Service`)
          exports.push(`get_${entityName}`, `get_${entityName}s`)
          exports.push(`create_${entityName}`, `update_${entityName}`, `delete_${entityName}`)
          break

        case 'api':
          exports.push(`router`)
          break
      }
    }

    switch (fileType) {
      case 'config':
        if (file.path.includes('config.py')) {
          exports.push('Settings', 'get_settings')
        }
        if (file.path.includes('database.py')) {
          exports.push('engine', 'SessionLocal', 'get_db')
        }
        if (file.path.includes('security.py')) {
          exports.push('verify_password', 'hash_password', 'create_access_token', 'verify_token')
        }
        if (file.path.includes('deps.py')) {
          exports.push('get_db', 'get_current_user')
        }
        break

      case 'main':
        exports.push('app')
        break
    }

    return exports
  }

  /**
   * Gets relationships relevant to a specific entity.
   */
  private getRelevantRelationships(
    entityName: string | undefined,
    relationships: Relationship[],
    schema: IntentSchema
  ): Relationship[] {
    if (!entityName) {
      return []
    }

    const relevant: Relationship[] = []

    for (const rel of relationships) {
      const fromLower = rel.from.toLowerCase()
      const toLower = rel.to.toLowerCase()

      if (fromLower === entityName || toLower === entityName) {
        relevant.push(rel)
      }
    }

    return relevant
  }

  /**
   * Converts a snake_case or plain string to PascalCase.
   * e.g. "user_profile" → "UserProfile", "user" → "User"
   */
  private capitalize(str: string): string {
    return str
      .split('_')
      .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join('')
  }

  /**
   * Gets a formatted context block for a file.
   * Includes the file's own context plus the expected API surface of all its dependencies.
   * This prevents generators from inventing import names that don't match what other files export.
   *
   * @param fileContext - Context for the file being generated
   * @param globalContext - Optional map of all file contexts (used to resolve dependency exports)
   */
  getContextBlock(fileContext: FileContext, globalContext?: Map<string, FileContext>): string {
    const lines: string[] = []
    lines.push(`## Context for ${fileContext.path}`)
    lines.push(`File Type: ${fileContext.fileType}`)
    lines.push(`Entity: ${fileContext.entityName || 'N/A'}`)

    if (fileContext.dependencies.length > 0) {
      lines.push(`\nDependencies (${fileContext.dependencies.length}):`)
      lines.push(...fileContext.dependencies.map(d => `  - ${d}`))
    }

    if (fileContext.dependents.length > 0) {
      lines.push(`\nDependents (${fileContext.dependents.length}):`)
      lines.push(...fileContext.dependents.map(d => `  - ${d}`))
    }

    // Emit the expected API surface of each dependency so the generator knows
    // exactly what names to import from them.
    if (globalContext && fileContext.dependencies.length > 0) {
      const depApis: string[] = []
      for (const depPath of fileContext.dependencies) {
        const depCtx = globalContext.get(depPath)
        if (depCtx && depCtx.exportsProvided.length > 0) {
          depApis.push(`  ${depPath} → exports: ${depCtx.exportsProvided.join(', ')}`)
        }
      }
      if (depApis.length > 0) {
        lines.push(`\nDependency APIs (use ONLY these names when importing from these files):`)
        lines.push(...depApis)
      }
    }

    if (fileContext.importsNeeded.length > 0) {
      lines.push(`\nRequired Imports (${fileContext.importsNeeded.length}):`)
      lines.push(`  NOTE: These are Python import statements, NOT file references:`)
      lines.push(
        `  - Standard library (typing, datetime, etc.) and third-party (pydantic, fastapi, sqlalchemy) imports`
      )
      lines.push(`  - Only imports starting with "app." reference actual project files`)
      lines.push('')
      lines.push(...fileContext.importsNeeded.slice(0, 15).map(i => `  - ${i}`))
      if (fileContext.importsNeeded.length > 15) {
        lines.push(`  ... and ${fileContext.importsNeeded.length - 15} more`)
      }
    }

    if (fileContext.exportsProvided.length > 0) {
      lines.push(`\nExports (${fileContext.exportsProvided.length}):`)
      lines.push(...fileContext.exportsProvided.map(e => `  - ${e}`))
    }

    if (fileContext.relationships.length > 0) {
      lines.push(`\nRelevant Relationships (${fileContext.relationships.length}):`)
      lines.push(...fileContext.relationships.map(r => `  - ${r.from} → ${r.to} (${r.type})`))
    }

    return lines.join('\n')
  }
}
