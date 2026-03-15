/**
 * Universal Prompt System - Universal File Generator
 *
 * Generates files using stack-specific patterns and the universal prompt builder.
 * Replaces the Python-specific file generator with a language-agnostic approach.
 */

import type { IntentSchema } from '../../agent/pipeline/intent-analyzer'
import type { Relationship } from '../../agent/pipeline/schema-validator'
import type { StackConfig } from '../../agent/stacks/stack-config.types'
import { logger } from '../../logger'
import { createInitializedRegistry } from '../../agent/stacks'
import { createUniversalPromptBuilder, UniversalPromptBuilder } from '../prompts/universal-prompts'

/**
 * File generation context
 */
export interface FileGenerationContext {
  /** Existing files in the project */
  existingFiles?: Array<{ path: string; content: string }>
  /** Memory block with project context */
  memoryBlock?: string
  /** Relationships between entities */
  relationships?: Relationship[]
  /** RAG context from vector database */
  ragContext?: any
  /** Additional context variables */
  [key: string]: any
}

/**
 * File generation result
 */
export interface FileGenerationResult {
  /** Generated file content */
  content: string
  /** Prompt used for generation */
  prompt: string
  /** Token count used */
  tokens: number
}

/**
 * Universal file generator for stack-aware code generation
 */
export class UniversalFileGenerator {
  private promptBuilder: UniversalPromptBuilder
  private stackRegistry: ReturnType<typeof createInitializedRegistry>

  constructor() {
    this.stackRegistry = createInitializedRegistry()
    this.promptBuilder = createUniversalPromptBuilder()
  }

  /**
   * Generate a file using stack-specific patterns
   * @param filePath - Path to file being generated
   * @param schema - Extracted schema
   * @param stackId - Stack identifier (defaults to Python/FastAPI)
   * @param context - Additional context for generation
   * @returns Generated file content
   */
  async generateFile(
    filePath: string,
    schema: IntentSchema,
    stackId: string = 'python-fastapi',
    context: FileGenerationContext = {}
  ): Promise<FileGenerationResult> {
    const stack = this.getStack(stackId)

    // Build the generation prompt
    const prompt = await this.promptBuilder.buildFileGenerationPrompt(filePath, schema, stackId, {
      existingFiles: context.existingFiles,
      memoryBlock: context.memoryBlock,
      relationships: context.relationships,
      ragContext: context.ragContext,
      ...context
    })

    // Estimate token count (rough approximation: 1 token ≈ 4 characters)
    const tokens = Math.ceil(prompt.length / 4)

    logger.debug('UniversalFileGenerator: generating %s for stack %s (%d tokens)', filePath, stackId, tokens)

    return {
      content: '', // Will be filled by LLM
      prompt,
      tokens
    }
  }

  /**
   * Generate multiple files in batch
   * @param filePaths - Array of file paths to generate
   * @param schema - Extracted schema
   * @param stackId - Stack identifier
   * @param context - Additional context for generation
   * @returns Array of file generation results
   */
  async generateFiles(
    filePaths: string[],
    schema: IntentSchema,
    stackId: string = 'python-fastapi',
    context: FileGenerationContext = {}
  ): Promise<Map<string, FileGenerationResult>> {
    const results = new Map<string, FileGenerationResult>()

    for (const filePath of filePaths) {
      try {
        const result = await this.generateFile(filePath, schema, stackId, context)
        results.set(filePath, result)
      } catch (error) {
        logger.error('UniversalFileGenerator: failed to generate %s', filePath, error)
        throw error
      }
    }

    return results
  }

  /**
   * Classify file type based on path
   * @param filePath - Path to file
   * @returns File type classification
   */
  classifyFileType(filePath: string): string {
    const normalized = filePath.toLowerCase()

    if (normalized.includes('model') || normalized.includes('entity')) {
      return 'model'
    } else if (normalized.includes('schema') || normalized.includes('dto')) {
      return 'schema'
    } else if (normalized.includes('service')) {
      return 'service'
    } else if (
      normalized.includes('controller') ||
      normalized.includes('router') ||
      normalized.includes('handler')
    ) {
      return 'controller'
    } else if (normalized.includes('config')) {
      return 'config'
    } else if (normalized.includes('database') || normalized.includes('db')) {
      return 'database'
    } else if (normalized.includes('security') || normalized.includes('auth')) {
      return 'security'
    } else if (normalized.includes('main') || normalized.includes('app') || normalized.includes('index')) {
      return 'entry'
    } else if (normalized.includes('package') || normalized.includes('requirements')) {
      return 'dependencies'
    } else if (normalized.includes('test') || normalized.includes('spec')) {
      return 'test'
    } else if (normalized.includes('migration') || normalized.includes('alembic')) {
      return 'migration'
    } else {
      return 'generic'
    }
  }

  /**
   * Get file stage for generation ordering
   * @param filePath - Path to file
   * @param stackId - Stack identifier
   * @returns Stage number (0-9, lower numbers generated first)
   */
  getFileStage(filePath: string, stackId: string = 'python-fastapi'): number {
    const stack = this.getStack(stackId)
    const fileType = this.classifyFileType(filePath)

    // Find matching stage from stack configuration
    for (const rule of stack.fileStaging) {
      for (const pattern of rule.patterns) {
        if (this.matchPattern(filePath, pattern)) {
          return rule.stage
        }
      }
    }

    // Default to middle stage if no match
    return 3
  }

  /**
   * Get token budget for a file
   * @param filePath - Path to file
   * @param stackId - Stack identifier
   * @returns Token budget configuration
   */
  getTokenBudget(
    filePath: string,
    stackId: string = 'python-fastapi'
  ): { maxTokens: number; contextWindow: number } {
    const stack = this.getStack(stackId)

    // Check for matching patterns in token budgets
    for (const [pattern, budget] of Object.entries(stack.tokenBudgets)) {
      if (this.matchPattern(filePath, pattern)) {
        return budget
      }
    }

    // Return default budget
    return stack.tokenBudgets.default || { maxTokens: 2400, contextWindow: 8192 }
  }

  /**
   * Check if file path matches a glob pattern
   * @param filePath - Path to check
   * @param pattern - Glob pattern to match
   * @returns True if pattern matches
   */
  private matchPattern(filePath: string, pattern: string): boolean {
    // Simple glob matching (supports * and **)
    const regexPattern = pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\./g, '\\.')

    const regex = new RegExp(regexPattern, 'i')
    return regex.test(filePath)
  }

  /**
   * Build file-specific context for generation
   * @param filePath - Path to file
   * @param schema - Extracted schema
   * @param stack - Stack configuration
   * @param context - Additional context
   * @returns File-specific context
   */
  private buildFileContext(
    filePath: string,
    schema: IntentSchema,
    stack: StackConfig,
    context: FileGenerationContext
  ): Record<string, any> {
    const fileType = this.classifyFileType(filePath)
    const entityName = this.extractEntityName(filePath, stack)
    const tokenBudget = this.getTokenBudget(filePath, stack.id)

    return {
      filePath,
      fileType,
      entityName,
      tokenBudget,
      schema,
      ...context
    }
  }

  /**
   * Extract entity name from file path
   * @param filePath - Path to file
   * @param stack - Stack configuration
   * @returns Entity name or null
   */
  private extractEntityName(filePath: string, stack: StackConfig): string | null {
    const fileName =
      filePath
        .split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '') || ''

    // Convert file name to entity case
    switch (stack.naming.entityCase) {
      case 'PascalCase':
        return this.toPascalCase(fileName)
      case 'camelCase':
        return this.toCamelCase(fileName)
      case 'snake_case':
        return this.toSnakeCase(fileName)
      case 'UPPER_CASE':
        return this.toUpperCase(fileName)
      default:
        return fileName
    }
  }

  /**
   * Convert string to PascalCase
   */
  private toPascalCase(str: string): string {
    return str
      .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
      .replace(/^(.)/, c => c.toUpperCase())
  }

  /**
   * Convert string to camelCase
   */
  private toCamelCase(str: string): string {
    const pascal = this.toPascalCase(str)
    return pascal.charAt(0).toLowerCase() + pascal.slice(1)
  }

  /**
   * Convert string to snake_case
   */
  private toSnakeCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '')
  }

  /**
   * Convert string to UPPER_CASE
   */
  private toUpperCase(str: string): string {
    return this.toSnakeCase(str).toUpperCase()
  }

  /**
   * Get stack configuration by ID
   */
  private getStack(stackId: string): StackConfig {
    const stack = this.stackRegistry.get(stackId)
    if (!stack) {
      logger.warn(`UniversalFileGenerator: stack not found: ${stackId}, using default`)
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
 * Create a universal file generator instance
 */
export function createUniversalFileGenerator(): UniversalFileGenerator {
  return new UniversalFileGenerator()
}

/**
 * Sort files by generation stage
 * @param filePaths - Array of file paths
 * @param stackId - Stack identifier
 * @returns Sorted array of file paths
 */
export function sortFilesByStage(filePaths: string[], stackId: string = 'python-fastapi'): string[] {
  const generator = createUniversalFileGenerator()

  return filePaths.sort((a, b) => {
    const stageA = generator.getFileStage(a, stackId)
    const stageB = generator.getFileStage(b, stackId)
    return stageA - stageB
  })
}

/**
 * Group files by generation stage
 * @param filePaths - Array of file paths
 * @param stackId - Stack identifier
 * @returns Map of stage to file paths
 */
export function groupFilesByStage(
  filePaths: string[],
  stackId: string = 'python-fastapi'
): Map<number, string[]> {
  const generator = createUniversalFileGenerator()
  const groups = new Map<number, string[]>()

  for (const filePath of filePaths) {
    const stage = generator.getFileStage(filePath, stackId)

    if (!groups.has(stage)) {
      groups.set(stage, [])
    }

    groups.get(stage)!.push(filePath)
  }

  return groups
}
