/**
 * Weaviate Enhanced Retriever for Agentic Development
 *
 * Provides advanced retrieval capabilities with semantic search, hybrid search,
 * filtering, and re-ranking for improved context retrieval.
 */

import type { WeaviateClient } from 'weaviate-ts-client'
import { logger } from '../../../logger'
import { WEAVIATE_CLASSES } from './schema'
import type { SearchFilters } from './vector-store'
import { getVectorStore } from './vector-store'

/**
 * Retrieved context with metadata
 */
export interface RetrievedContext {
  files: Array<{
    path: string
    content: string
    score: number
    metadata: any
  }>
  codeSnippets: Array<{
    snippet: string
    description: string
    filePath: string
    score: number
    metadata: any
  }>
  documentation: Array<{
    title: string
    content: string
    score: number
    metadata: any
  }>
  conversations: Array<{
    prompt: string
    response: string
    score: number
    metadata: any
  }>
  projects: Array<{
    name: string
    description: string
    score: number
    metadata: any
  }>
}

/**
 * Retrieval options
 */
export interface RetrievalOptions {
  topK?: number
  includeFiles?: boolean
  includeCodeSnippets?: boolean
  includeDocumentation?: boolean
  includeConversations?: boolean
  includeSimilarProjects?: boolean
  filters?: SearchFilters
  minScore?: number
  enableReRanking?: boolean
}

/**
 * Enhanced retriever using Weaviate
 */
export class WeaviateRetriever {
  private client: WeaviateClient

  constructor(client: WeaviateClient) {
    this.client = client
  }

  /**
   * Retrieve relevant context for a query
   */
  async retrieveContext(query: string, options: RetrievalOptions = {}): Promise<RetrievedContext> {
    const {
      topK = 5,
      includeFiles = true,
      includeCodeSnippets = true,
      includeDocumentation = true,
      includeConversations = true,
      includeSimilarProjects = true,
      filters = {},
      minScore = 0.5,
      enableReRanking = true
    } = options

    const startTime = Date.now()

    try {
      const vectorStore = getVectorStore()

      // Retrieve from different sources in parallel
      const [files, codeSnippets, documentation, conversations, projects] = await Promise.all([
        includeFiles ? this.retrieveFiles(query, topK, filters, minScore, vectorStore) : Promise.resolve([]),
        includeCodeSnippets
          ? this.retrieveCodeSnippets(query, topK, filters, minScore, vectorStore)
          : Promise.resolve([]),
        includeDocumentation
          ? this.retrieveDocumentation(query, topK, filters, minScore, vectorStore)
          : Promise.resolve([]),
        includeConversations
          ? this.retrieveConversations(query, topK, filters, minScore, vectorStore)
          : Promise.resolve([]),
        includeSimilarProjects
          ? this.retrieveSimilarProjects(query, topK, filters, minScore, vectorStore)
          : Promise.resolve([])
      ])

      // Re-rank results if enabled
      const context: RetrievedContext = {
        files: enableReRanking ? this.reRankResults(files, query) : files,
        codeSnippets: enableReRanking ? this.reRankResults(codeSnippets, query) : codeSnippets,
        documentation: enableReRanking ? this.reRankResults(documentation, query) : documentation,
        conversations: enableReRanking ? this.reRankResults(conversations, query) : conversations,
        projects: enableReRanking ? this.reRankResults(projects, query) : projects
      }

      const retrievalTime = Date.now() - startTime
      logger.info(
        'Context retrieval completed in %dms: files=%d, snippets=%d, docs=%d, convs=%d, projects=%d',
        retrievalTime,
        context.files.length,
        context.codeSnippets.length,
        context.documentation.length,
        context.conversations.length,
        context.projects.length
      )

      return context
    } catch (error: any) {
      logger.error('Failed to retrieve context: %s', error.message)
      throw error
    }
  }

  /**
   * Retrieve relevant files
   */
  private async retrieveFiles(
    query: string,
    topK: number,
    filters: SearchFilters,
    minScore: number,
    vectorStore: ReturnType<typeof getVectorStore>
  ): Promise<Array<{ path: string; content: string; score: number; metadata: any }>> {
    try {
      const { results } = await vectorStore.search(WEAVIATE_CLASSES.FILE, query, {
        limit: topK,
        filters
      })

      return results
        .filter(r => r.score >= minScore)
        .map(result => ({
          path: result.properties.path,
          content: result.properties.content,
          score: result.score,
          metadata: {
            name: result.properties.name,
            extension: result.properties.extension,
            language: result.properties.language,
            framework: result.properties.framework,
            fileType: result.properties.fileType,
            size: result.properties.size,
            lineCount: result.properties.lineCount,
            dependencies: result.properties.dependencies,
            imports: result.properties.imports,
            exports: result.properties.exports
          }
        }))
    } catch (error: any) {
      logger.warn('Failed to retrieve files: %s', error.message)
      return []
    }
  }

  /**
   * Retrieve relevant code snippets
   */
  private async retrieveCodeSnippets(
    query: string,
    topK: number,
    filters: SearchFilters,
    minScore: number,
    vectorStore: ReturnType<typeof getVectorStore>
  ): Promise<
    Array<{ snippet: string; description: string; filePath: string; score: number; metadata: any }>
  > {
    try {
      const { results } = await vectorStore.search(WEAVIATE_CLASSES.CODE_SNIPPET, query, {
        limit: topK,
        filters
      })

      return results
        .filter(r => r.score >= minScore)
        .map(result => ({
          snippet: result.properties.snippet,
          description: result.properties.description,
          filePath: result.properties.filePath,
          score: result.score,
          metadata: {
            language: result.properties.language,
            framework: result.properties.framework,
            category: result.properties.category,
            pattern: result.properties.pattern,
            isBestPractice: result.properties.isBestPractice,
            usageCount: result.properties.usageCount
          }
        }))
    } catch (error: any) {
      logger.warn('Failed to retrieve code snippets: %s', error.message)
      return []
    }
  }

  /**
   * Retrieve relevant documentation
   */
  private async retrieveDocumentation(
    query: string,
    topK: number,
    filters: SearchFilters,
    minScore: number,
    vectorStore: ReturnType<typeof getVectorStore>
  ): Promise<Array<{ title: string; content: string; score: number; metadata: any }>> {
    try {
      const { results } = await vectorStore.search(WEAVIATE_CLASSES.DOCUMENTATION, query, {
        limit: topK,
        filters
      })

      return results
        .filter(r => r.score >= minScore)
        .map(result => ({
          title: result.properties.title,
          content: result.properties.content,
          score: result.score,
          metadata: {
            type: result.properties.type,
            language: result.properties.language,
            framework: result.properties.framework,
            tags: result.properties.tags,
            difficulty: result.properties.difficulty,
            source: result.properties.source
          }
        }))
    } catch (error: any) {
      logger.warn('Failed to retrieve documentation: %s', error.message)
      return []
    }
  }

  /**
   * Retrieve relevant conversations
   */
  private async retrieveConversations(
    query: string,
    topK: number,
    filters: SearchFilters,
    minScore: number,
    vectorStore: ReturnType<typeof getVectorStore>
  ): Promise<Array<{ prompt: string; response: string; score: number; metadata: any }>> {
    try {
      const { results } = await vectorStore.search(WEAVIATE_CLASSES.CONVERSATION, query, {
        limit: topK,
        filters
      })

      return results
        .filter(r => r.score >= minScore)
        .map(result => ({
          prompt: result.properties.prompt,
          response: result.properties.response,
          score: result.score,
          metadata: {
            context: result.properties.context,
            language: result.properties.language,
            framework: result.properties.framework,
            intent: result.properties.intent,
            success: result.properties.success,
            filesGenerated: result.properties.filesGenerated
          }
        }))
    } catch (error: any) {
      logger.warn('Failed to retrieve conversations: %s', error.message)
      return []
    }
  }

  /**
   * Retrieve similar projects
   */
  private async retrieveSimilarProjects(
    query: string,
    topK: number,
    filters: SearchFilters,
    minScore: number,
    vectorStore: ReturnType<typeof getVectorStore>
  ): Promise<Array<{ name: string; description: string; score: number; metadata: any }>> {
    try {
      const { results } = await vectorStore.search(WEAVIATE_CLASSES.PROJECT, query, {
        limit: topK,
        filters
      })

      return results
        .filter(r => r.score >= minScore)
        .map(result => ({
          name: result.properties.name,
          description: result.properties.description,
          score: result.score,
          metadata: {
            language: result.properties.language,
            framework: result.properties.framework,
            stackId: result.properties.stackId,
            features: result.properties.features,
            fileCount: result.properties.fileCount,
            totalSize: result.properties.totalSize
          }
        }))
    } catch (error: any) {
      logger.warn('Failed to retrieve similar projects: %s', error.message)
      return []
    }
  }

  /**
   * Re-rank results based on relevance to query
   */
  private reRankResults<
    T extends { score: number; metadata?: { isBestPractice?: boolean; usageCount?: number } }
  >(results: T[], query: string): T[] {
    if (results.length === 0) {
      return results
    }

    // Simple re-ranking based on score and diversity
    // Sort by score first
    const sorted = [...results].sort((a, b) => b.score - a.score)

    // Apply score boost for best practices and high-usage items
    return sorted.map(result => {
      const boostedResult = { ...result }

      // Boost best practice code snippets
      if (result.metadata?.isBestPractice) {
        boostedResult.score = Math.min(1, boostedResult.score * 1.1)
      }

      // Boost frequently used snippets
      if (result.metadata?.usageCount !== undefined && result.metadata.usageCount > 10) {
        boostedResult.score = Math.min(1, boostedResult.score * 1.05)
      }

      return boostedResult
    })
  }

  /**
   * Build context string from retrieved context
   */
  buildContextString(context: RetrievedContext, maxLength: number = 8000): string {
    const parts: string[] = []

    // Add similar projects
    if (context.projects.length > 0) {
      parts.push('## Similar Projects\n')
      context.projects.forEach(project => {
        const lang = project.metadata?.language ?? 'unknown'
        const framework = project.metadata?.framework ?? 'unknown'
        parts.push(`- ${project.name} (${lang}/${framework}): ${project.description}`)
      })
      parts.push('')
    }

    // Add relevant files
    if (context.files.length > 0) {
      parts.push('## Relevant Files\n')
      context.files.forEach(file => {
        parts.push(
          `### ${file.path}\n\`\`\`${file.metadata.extension.replace('.', '')}\n${file.content}\n\`\`\``
        )
      })
      parts.push('')
    }

    // Add code snippets
    if (context.codeSnippets.length > 0) {
      parts.push('## Code Snippets\n')
      context.codeSnippets.forEach(snippet => {
        parts.push(`### ${snippet.description}\n\`\`\`\n${snippet.snippet}\n\`\`\``)
      })
      parts.push('')
    }

    // Add documentation
    if (context.documentation.length > 0) {
      parts.push('## Documentation\n')
      context.documentation.forEach(doc => {
        parts.push(`### ${doc.title}\n${doc.content}`)
      })
      parts.push('')
    }

    // Add conversations
    if (context.conversations.length > 0) {
      parts.push('## Similar Conversations\n')
      context.conversations.forEach(conv => {
        parts.push(`### User: ${conv.prompt}\n### Response: ${conv.response}`)
      })
      parts.push('')
    }

    let fullContext = parts.join('\n')

    // Truncate if too long
    if (fullContext.length > maxLength) {
      fullContext = fullContext.slice(0, maxLength) + '\n\n... (context truncated)'
    }

    return fullContext
  }

  /**
   * Get retrieval statistics
   */
  getRetrievalStats(context: RetrievedContext): {
    totalItems: number
    averageScore: number
    breakdown: Record<string, number>
  } {
    const allItems = [
      ...context.files,
      ...context.codeSnippets,
      ...context.documentation,
      ...context.conversations,
      ...context.projects
    ]

    const totalItems = allItems.length
    const averageScore = totalItems > 0 ? allItems.reduce((sum, item) => sum + item.score, 0) / totalItems : 0

    const breakdown = {
      files: context.files.length,
      codeSnippets: context.codeSnippets.length,
      documentation: context.documentation.length,
      conversations: context.conversations.length,
      projects: context.projects.length
    }

    return { totalItems, averageScore, breakdown }
  }
}

/**
 * Global retriever instance
 */
let globalRetriever: WeaviateRetriever | null = null

/**
 * Initialize global retriever
 */
export function initializeWeaviateRetriever(client: WeaviateClient): WeaviateRetriever {
  if (globalRetriever) {
    logger.info('Weaviate retriever already initialized')
    return globalRetriever
  }

  globalRetriever = new WeaviateRetriever(client)
  return globalRetriever
}

/**
 * Get global retriever
 */
export function getWeaviateRetriever(): WeaviateRetriever {
  if (!globalRetriever) {
    throw new Error('Weaviate retriever not initialized. Call initializeWeaviateRetriever() first.')
  }
  return globalRetriever
}
