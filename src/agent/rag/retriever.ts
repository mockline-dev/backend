import type { Application } from '../../declarations'
import { logger } from '../../logger'
import { r2Client } from '../../storage/r2.client'
import { embeddingStore } from './store'

export interface FileContext {
  path: string
  content: string
}

/**
 * Retrieves the most relevant project files for a given query using semantic search.
 * Falls back to listing all files when the embedding store is empty.
 */
export class ContextRetriever {
  private app: Application

  constructor(app: Application) {
    this.app = app
  }

  /**
   * Returns up to `topK` files relevant to `query` for the given project.
   * The returned objects include both the file path and its content from R2.
   */
  async getRelevantFiles(projectId: string, query: string, topK = 5): Promise<FileContext[]> {
    let paths: string[]

    if (embeddingStore.has(projectId)) {
      paths = await embeddingStore.query(projectId, query, topK)
    } else {
      // Embedding store not populated yet — fall back to listing recent files from MongoDB
      const result = (await this.app.service('files').find({
        query: { projectId, $limit: topK, $sort: { createdAt: -1 } }
      })) as any
      paths = (result.data ?? result).map((f: any) => f.name)
    }

    const contextResults = await Promise.all(
      paths.map(async path => {
        try {
          const content = await r2Client.getObject(`projects/${projectId}/${path}`)
          return { path, content } as FileContext
        } catch (err: any) {
          logger.warn('ContextRetriever: could not fetch %s/%s: %s', projectId, path, err.message)
          return null
        }
      })
    )

    return contextResults.filter((context): context is FileContext => context !== null)
  }

  /**
   * Indexes all existing files for a project into the embedding store.
   * Call after rollback or on fresh workspace load.
   */
  async indexProject(projectId: string): Promise<void> {
    embeddingStore.clear(projectId)
    const result = (await this.app.service('files').find({
      query: { projectId, $limit: 500 }
    })) as any
    const files: any[] = result.data ?? result

    for (const file of files) {
      try {
        const content = await r2Client.getObject(file.key)
        await embeddingStore.add(projectId, file.name, content)
      } catch {
        // Non-fatal — skip unreadable files
      }
    }

    logger.info('ContextRetriever: indexed %d files for project %s', files.length, projectId)
  }
}
