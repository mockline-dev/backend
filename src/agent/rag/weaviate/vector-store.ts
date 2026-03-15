/**
 * Weaviate Vector Store for Agentic Development
 *
 * Provides comprehensive vector storage and retrieval capabilities for projects,
 * files, code snippets, documentation, and conversations with semantic search.
 */

import type { WeaviateClient } from 'weaviate-ts-client'
import { embed } from '../../../llm/embeddings'
import { logger } from '../../../logger'
import { WEAVIATE_CLASSES, createWeaviateSchema, validateVectorDimension } from './schema'
import { getWeaviateConfig, withRetry } from './weaviate-client'

/**
 * Search filters for vector queries
 */
export interface SearchFilters {
  projectId?: string
  language?: string
  framework?: string
  fileType?: string
  category?: string
  isBestPractice?: boolean
  difficulty?: string
  intent?: string
  success?: boolean
}

/**
 * Search result with metadata
 */
export interface SearchResult<T = any> {
  id: string
  score: number
  properties: T
}

/**
 * Search options
 */
export interface SearchOptions {
  limit?: number
  offset?: number
  filters?: SearchFilters
  hybrid?: boolean
  alpha?: number // 0 = pure BM25, 1 = pure vector, 0.5 = balanced
}

/**
 * Indexing metrics
 */
export interface IndexingMetrics {
  totalIndexed: number
  totalFailed: number
  indexingTime: number
  averageTimePerItem: number
}

/**
 * Search metrics
 */
export interface SearchMetrics {
  searchTime: number
  resultsCount: number
  averageScore: number
}

/**
 * Vector store for agentic development
 */
export class WeaviateVectorStore {
  private client: WeaviateClient
  private config: ReturnType<typeof getWeaviateConfig>
  private isInitialized: boolean = false

  constructor(client: WeaviateClient, config: ReturnType<typeof getWeaviateConfig>) {
    this.client = client
    this.config = config
  }

  /**
   * Initialize the vector store and create schema
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.info('Weaviate vector store already initialized')
      return
    }

    logger.info('Initializing Weaviate vector store')

    try {
      await createWeaviateSchema(this.client)
      this.isInitialized = true
      logger.info('Weaviate vector store initialized successfully')
    } catch (error: any) {
      logger.error('Failed to initialize Weaviate vector store: %s', error.message)
      throw error
    }
  }

  /**
   * Check if vector store is initialized
   */
  isReady(): boolean {
    return this.isInitialized
  }

  /**
   * Index a project with embeddings
   */
  async indexProject(projectData: {
    projectId: string
    name: string
    description: string
    language: string
    framework: string
    stackId: string
    features: string[]
    fileCount: number
    totalSize: number
  }): Promise<string> {
    const startTime = Date.now()

    try {
      // Create embedding from project description and metadata
      const textToEmbed = `${projectData.name} ${projectData.description} ${projectData.language} ${projectData.framework} ${projectData.features.join(' ')}`
      const vector = await embed(textToEmbed)

      if (!validateVectorDimension(vector, this.config)) {
        throw new Error(
          `Vector dimension mismatch: expected ${this.config.vectorDimension}, got ${vector.length}`
        )
      }

      const dataObj = {
        class: WEAVIATE_CLASSES.PROJECT,
        id: this.generateId(projectData.projectId),
        vector,
        properties: {
          projectId: projectData.projectId,
          name: projectData.name,
          description: projectData.description,
          language: projectData.language,
          framework: projectData.framework,
          stackId: projectData.stackId,
          features: projectData.features,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          fileCount: projectData.fileCount,
          totalSize: projectData.totalSize
        }
      }

      await withRetry(
        () =>
          this.client.data
            .creator()
            .withClassName(WEAVIATE_CLASSES.PROJECT)
            .withId(dataObj.id)
            .withProperties(dataObj.properties)
            .withVector(dataObj.vector)
            .do(),
        this.config,
        'indexProject'
      )

      logger.info('Indexed project %s in %dms', projectData.projectId, Date.now() - startTime)

      return dataObj.id
    } catch (error: any) {
      logger.error('Failed to index project %s: %s', projectData.projectId, error.message)
      throw error
    }
  }

  /**
   * Index a file with embeddings
   */
  async indexFile(fileData: {
    projectId: string
    path: string
    name: string
    extension: string
    content: string
    language: string
    framework: string
    fileType: string
    size: number
    lineCount: number
    dependencies?: string[]
    imports?: string[]
    exports?: string[]
  }): Promise<string> {
    const startTime = Date.now()

    try {
      // Create embedding from file content and metadata
      const textToEmbed = `${fileData.name} ${fileData.path} ${fileData.content} ${fileData.language} ${fileData.framework} ${fileData.fileType}`
      const vector = await embed(textToEmbed)

      if (!validateVectorDimension(vector, this.config)) {
        throw new Error(
          `Vector dimension mismatch: expected ${this.config.vectorDimension}, got ${vector.length}`
        )
      }

      const dataObj = {
        class: WEAVIATE_CLASSES.FILE,
        id: this.generateId(`${fileData.projectId}:${fileData.path}`),
        vector,
        properties: {
          projectId: fileData.projectId,
          path: fileData.path,
          name: fileData.name,
          extension: fileData.extension,
          content: fileData.content,
          contentPreview: fileData.content.slice(0, 500),
          language: fileData.language,
          framework: fileData.framework,
          fileType: fileData.fileType,
          size: fileData.size,
          lineCount: fileData.lineCount,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          dependencies: fileData.dependencies ?? [],
          imports: fileData.imports ?? [],
          exports: fileData.exports ?? []
        }
      }

      await withRetry(
        () =>
          this.client.data
            .creator()
            .withClassName(WEAVIATE_CLASSES.FILE)
            .withId(dataObj.id)
            .withProperties(dataObj.properties)
            .withVector(dataObj.vector)
            .do(),
        this.config,
        'indexFile'
      )

      logger.debug('Indexed file %s in %dms', fileData.path, Date.now() - startTime)

      return dataObj.id
    } catch (error: any) {
      logger.error('Failed to index file %s: %s', fileData.path, error.message)
      throw error
    }
  }

  /**
   * Index multiple files in batch
   */
  async indexFilesBatch(
    fileDataArray: Array<{
      projectId: string
      path: string
      name: string
      extension: string
      content: string
      language: string
      framework: string
      fileType: string
      size: number
      lineCount: number
      dependencies?: string[]
      imports?: string[]
      exports?: string[]
    }>
  ): Promise<IndexingMetrics> {
    const startTime = Date.now()
    let successCount = 0
    let failCount = 0

    logger.info('Starting batch indexing of %d files', fileDataArray.length)

    // Process in batches to avoid overwhelming the system
    const batchSize = this.config.batchSize
    for (let i = 0; i < fileDataArray.length; i += batchSize) {
      const batch = fileDataArray.slice(i, i + batchSize)

      const results = await Promise.allSettled(batch.map(fileData => this.indexFile(fileData)))

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          successCount++
        } else {
          failCount++
          logger.warn('Failed to index file %s: %s', batch[index].path, result.reason)
        }
      })

      logger.info(
        'Batch progress: %d/%d files processed (success=%d, failed=%d)',
        Math.min(i + batchSize, fileDataArray.length),
        fileDataArray.length,
        successCount,
        failCount
      )
    }

    const totalTime = Date.now() - startTime
    const metrics: IndexingMetrics = {
      totalIndexed: successCount,
      totalFailed: failCount,
      indexingTime: totalTime,
      averageTimePerItem: totalTime / fileDataArray.length
    }

    logger.info(
      'Batch indexing completed: %d succeeded, %d failed in %dms (avg=%dms/item)',
      successCount,
      failCount,
      totalTime,
      metrics.averageTimePerItem
    )

    return metrics
  }

  /**
   * Index a code snippet with embeddings
   */
  async indexCodeSnippet(snippetData: {
    projectId: string
    filePath: string
    snippet: string
    description: string
    language: string
    framework: string
    category: string
    pattern?: string
    isBestPractice?: boolean
  }): Promise<string> {
    const startTime = Date.now()

    try {
      // Create embedding from snippet and description
      const textToEmbed = `${snippetData.description} ${snippetData.snippet} ${snippetData.language} ${snippetData.framework} ${snippetData.category}`
      const vector = await embed(textToEmbed)

      if (!validateVectorDimension(vector, this.config)) {
        throw new Error(
          `Vector dimension mismatch: expected ${this.config.vectorDimension}, got ${vector.length}`
        )
      }

      const dataObj = {
        class: WEAVIATE_CLASSES.CODE_SNIPPET,
        id: this.generateId(`${snippetData.projectId}:${snippetData.filePath}:${Date.now()}`),
        vector,
        properties: {
          projectId: snippetData.projectId,
          filePath: snippetData.filePath,
          snippet: snippetData.snippet,
          description: snippetData.description,
          language: snippetData.language,
          framework: snippetData.framework,
          category: snippetData.category,
          pattern: snippetData.pattern ?? '',
          isBestPractice: snippetData.isBestPractice ?? false,
          usageCount: 0,
          createdAt: new Date().toISOString()
        }
      }

      await withRetry(
        () =>
          this.client.data
            .creator()
            .withClassName(WEAVIATE_CLASSES.CODE_SNIPPET)
            .withId(dataObj.id)
            .withProperties(dataObj.properties)
            .withVector(dataObj.vector)
            .do(),
        this.config,
        'indexCodeSnippet'
      )

      logger.debug('Indexed code snippet from %s in %dms', snippetData.filePath, Date.now() - startTime)

      return dataObj.id
    } catch (error: any) {
      logger.error('Failed to index code snippet: %s', error.message)
      throw error
    }
  }

  /**
   * Index documentation with embeddings
   */
  async indexDocumentation(docData: {
    projectId: string
    title: string
    content: string
    type: string
    language: string
    framework: string
    tags?: string[]
    difficulty?: string
    source?: string
  }): Promise<string> {
    const startTime = Date.now()

    try {
      // Create embedding from documentation
      const textToEmbed = `${docData.title} ${docData.content} ${docData.language} ${docData.framework} ${docData.tags?.join(' ') ?? ''}`
      const vector = await embed(textToEmbed)

      if (!validateVectorDimension(vector, this.config)) {
        throw new Error(
          `Vector dimension mismatch: expected ${this.config.vectorDimension}, got ${vector.length}`
        )
      }

      const dataObj = {
        class: WEAVIATE_CLASSES.DOCUMENTATION,
        id: this.generateId(`${docData.projectId}:${docData.title}:${Date.now()}`),
        vector,
        properties: {
          projectId: docData.projectId,
          title: docData.title,
          content: docData.content,
          type: docData.type,
          language: docData.language,
          framework: docData.framework,
          tags: docData.tags ?? [],
          difficulty: docData.difficulty ?? 'intermediate',
          source: docData.source ?? 'generated',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      }

      await withRetry(
        () =>
          this.client.data
            .creator()
            .withClassName(WEAVIATE_CLASSES.DOCUMENTATION)
            .withId(dataObj.id)
            .withProperties(dataObj.properties)
            .withVector(dataObj.vector)
            .do(),
        this.config,
        'indexDocumentation'
      )

      logger.debug('Indexed documentation "%s" in %dms', docData.title, Date.now() - startTime)

      return dataObj.id
    } catch (error: any) {
      logger.error('Failed to index documentation: %s', error.message)
      throw error
    }
  }

  /**
   * Index a conversation with embeddings
   */
  async indexConversation(convData: {
    projectId: string
    userId: string
    prompt: string
    response: string
    context?: string
    language: string
    framework: string
    intent: string
    success: boolean
    filesGenerated: number
  }): Promise<string> {
    const startTime = Date.now()

    try {
      // Create embedding from conversation
      const textToEmbed = `${convData.prompt} ${convData.response} ${convData.context ?? ''} ${convData.intent}`
      const vector = await embed(textToEmbed)

      if (!validateVectorDimension(vector, this.config)) {
        throw new Error(
          `Vector dimension mismatch: expected ${this.config.vectorDimension}, got ${vector.length}`
        )
      }

      const dataObj = {
        class: WEAVIATE_CLASSES.CONVERSATION,
        id: this.generateId(`${convData.projectId}:${convData.userId}:${Date.now()}`),
        vector,
        properties: {
          projectId: convData.projectId,
          userId: convData.userId,
          prompt: convData.prompt,
          response: convData.response,
          context: convData.context ?? '',
          language: convData.language,
          framework: convData.framework,
          intent: convData.intent,
          success: convData.success,
          filesGenerated: convData.filesGenerated,
          createdAt: new Date().toISOString()
        }
      }

      await withRetry(
        () =>
          this.client.data
            .creator()
            .withClassName(WEAVIATE_CLASSES.CONVERSATION)
            .withId(dataObj.id)
            .withProperties(dataObj.properties)
            .withVector(dataObj.vector)
            .do(),
        this.config,
        'indexConversation'
      )

      logger.debug('Indexed conversation for project %s in %dms', convData.projectId, Date.now() - startTime)

      return dataObj.id
    } catch (error: any) {
      logger.error('Failed to index conversation: %s', error.message)
      throw error
    }
  }

  /**
   * Semantic search with optional filters
   */
  async search(
    className: string,
    queryText: string,
    options: SearchOptions = {}
  ): Promise<{ results: SearchResult[]; metrics: SearchMetrics }> {
    const startTime = Date.now()
    const { limit = 10, offset = 0, filters = {}, hybrid = false, alpha = 0.5 } = options

    try {
      const vector = await embed(queryText)

      if (!validateVectorDimension(vector, this.config)) {
        throw new Error(
          `Vector dimension mismatch: expected ${this.config.vectorDimension}, got ${vector.length}`
        )
      }

      // Build near vector query
      const nearVector: any = { vector }

      // Build where clause for filters
      const whereClause = this.buildWhereClause(filters)

      // Build the query
      let builder = this.client.graphql
        .get()
        .withClassName(className)
        .withNearVector(nearVector)
        .withLimit(limit)
        .withOffset(offset)

      if (whereClause) {
        builder = builder.withWhere(whereClause)
      }

      // Add fields to retrieve
      const fields = this.getFieldsForClass(className)
      builder = builder.withFields(fields)

      const result = await withRetry(() => builder.do(), this.config, 'search')

      const results: SearchResult[] = result.data.Get[className].map((item: any) => ({
        id: item._additional.id,
        score: item._additional.distance ? 1 - item._additional.distance : 0,
        properties: this.extractProperties(item, className)
      }))

      const searchTime = Date.now() - startTime
      const averageScore =
        results.length > 0 ? results.reduce((sum, r) => sum + r.score, 0) / results.length : 0

      const metrics: SearchMetrics = {
        searchTime,
        resultsCount: results.length,
        averageScore
      }

      logger.debug(
        'Search completed in %dms for class %s: %d results (avg score=%.3f)',
        searchTime,
        className,
        results.length,
        averageScore
      )

      return { results, metrics }
    } catch (error: any) {
      logger.error('Search failed for class %s: %s', className, error.message)
      throw error
    }
  }

  /**
   * Delete all data for a project
   */
  async deleteProject(projectId: string): Promise<void> {
    logger.info('Deleting all data for project %s', projectId)

    try {
      const classes = Object.values(WEAVIATE_CLASSES)

      for (const className of classes) {
        // First, find all objects for this project
        const whereClause = {
          operator: 'And' as const,
          operands: [
            {
              path: ['projectId'],
              operator: 'Equal' as const,
              valueText: projectId
            }
          ]
        }

        // Get all objects to delete
        const builder = this.client.graphql
          .get()
          .withClassName(className)
          .withWhere(whereClause)
          .withFields('_additional { id }')

        const result = await withRetry(() => builder.do(), this.config, `findObjects-${className}`)

        const objects = result.data.Get[className] ?? []
        logger.info(
          'Found %d objects to delete in class %s for project %s',
          objects.length,
          className,
          projectId
        )

        // Delete each object individually
        for (const obj of objects) {
          const id = obj._additional.id
          await withRetry(
            () => this.client.data.deleter().withId(id).withClassName(className).do(),
            this.config,
            `deleteObject-${className}`
          )
        }
      }

      logger.info('Successfully deleted all data for project %s', projectId)
    } catch (error: any) {
      logger.error('Failed to delete project %s: %s', projectId, error.message)
      throw error
    }
  }

  /**
   * Update project data
   */
  async updateProject(
    projectId: string,
    updates: Partial<{
      name: string
      description: string
      language: string
      framework: string
      features: string[]
      fileCount: number
      totalSize: number
    }>
  ): Promise<void> {
    logger.info('Updating project %s', projectId)

    try {
      const id = this.generateId(projectId)
      const properties = {
        ...updates,
        updatedAt: new Date().toISOString()
      }

      await withRetry(
        () =>
          this.client.data
            .merger()
            .withId(id)
            .withClassName(WEAVIATE_CLASSES.PROJECT)
            .withProperties(properties)
            .do(),
        this.config,
        'updateProject'
      )

      logger.info('Successfully updated project %s', projectId)
    } catch (error: any) {
      logger.error('Failed to update project %s: %s', projectId, error.message)
      throw error
    }
  }

  /**
   * Build where clause from filters
   */
  private buildWhereClause(filters: SearchFilters): any {
    const operands: any[] = []

    if (filters.projectId) {
      operands.push({
        path: ['projectId'],
        operator: 'Equal',
        valueText: filters.projectId
      })
    }

    if (filters.language) {
      operands.push({
        path: ['language'],
        operator: 'Equal',
        valueText: filters.language
      })
    }

    if (filters.framework) {
      operands.push({
        path: ['framework'],
        operator: 'Equal',
        valueText: filters.framework
      })
    }

    if (filters.fileType) {
      operands.push({
        path: ['fileType'],
        operator: 'Equal',
        valueText: filters.fileType
      })
    }

    if (filters.category) {
      operands.push({
        path: ['category'],
        operator: 'Equal',
        valueText: filters.category
      })
    }

    if (filters.isBestPractice !== undefined) {
      operands.push({
        path: ['isBestPractice'],
        operator: 'Equal',
        valueBoolean: filters.isBestPractice
      })
    }

    if (filters.difficulty) {
      operands.push({
        path: ['difficulty'],
        operator: 'Equal',
        valueText: filters.difficulty
      })
    }

    if (filters.intent) {
      operands.push({
        path: ['intent'],
        operator: 'Equal',
        valueText: filters.intent
      })
    }

    if (filters.success !== undefined) {
      operands.push({
        path: ['success'],
        operator: 'Equal',
        valueBoolean: filters.success
      })
    }

    return operands.length > 0 ? { operator: 'And', operands } : null
  }

  /**
   * Get fields to retrieve for a class
   */
  private getFieldsForClass(className: string): string {
    const fields = ['_additional { id distance }']

    switch (className) {
      case WEAVIATE_CLASSES.PROJECT:
        return fields
          .concat([
            'projectId',
            'name',
            'description',
            'language',
            'framework',
            'stackId',
            'features',
            'fileCount',
            'totalSize',
            'createdAt',
            'updatedAt'
          ])
          .join(' ')

      case WEAVIATE_CLASSES.FILE:
        return fields
          .concat([
            'projectId',
            'path',
            'name',
            'extension',
            'content',
            'contentPreview',
            'language',
            'framework',
            'fileType',
            'size',
            'lineCount',
            'createdAt',
            'updatedAt',
            'dependencies',
            'imports',
            'exports'
          ])
          .join(' ')

      case WEAVIATE_CLASSES.CODE_SNIPPET:
        return fields
          .concat([
            'projectId',
            'filePath',
            'snippet',
            'description',
            'language',
            'framework',
            'category',
            'pattern',
            'isBestPractice',
            'usageCount',
            'createdAt'
          ])
          .join(' ')

      case WEAVIATE_CLASSES.DOCUMENTATION:
        return fields
          .concat([
            'projectId',
            'title',
            'content',
            'type',
            'language',
            'framework',
            'tags',
            'difficulty',
            'source',
            'createdAt',
            'updatedAt'
          ])
          .join(' ')

      case WEAVIATE_CLASSES.CONVERSATION:
        return fields
          .concat([
            'projectId',
            'userId',
            'prompt',
            'response',
            'context',
            'language',
            'framework',
            'intent',
            'success',
            'filesGenerated',
            'createdAt'
          ])
          .join(' ')

      default:
        return fields.join(' ')
    }
  }

  /**
   * Extract properties from a search result
   */
  private extractProperties(item: any, className: string): any {
    const { _additional, ...properties } = item
    return properties
  }

  /**
   * Generate a consistent ID for Weaviate objects
   */
  private generateId(key: string): string {
    // Simple hash-based ID generation
    let hash = 0
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16)
  }
}

/**
 * Global vector store instance
 */
let globalVectorStore: WeaviateVectorStore | null = null

/**
 * Initialize global vector store
 */
export async function initializeVectorStore(
  client: WeaviateClient,
  config: ReturnType<typeof getWeaviateConfig>
): Promise<WeaviateVectorStore> {
  if (globalVectorStore) {
    logger.info('Vector store already initialized')
    return globalVectorStore
  }

  globalVectorStore = new WeaviateVectorStore(client, config)
  await globalVectorStore.initialize()
  return globalVectorStore
}

/**
 * Get global vector store
 */
export function getVectorStore(): WeaviateVectorStore {
  if (!globalVectorStore) {
    throw new Error('Vector store not initialized. Call initializeVectorStore() first.')
  }
  return globalVectorStore
}
