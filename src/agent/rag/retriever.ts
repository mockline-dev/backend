import type { Application } from '../../declarations'
import { logger } from '../../logger'
import { r2Client } from '../../storage/r2.client'
import { embeddingStore } from './store'

export interface FileContext {
  path: string
  content: string
}

interface FileRecord {
  name: string
  key: string
}

interface FindResult {
  data?: FileRecord[]
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
      })) as FindResult | FileRecord[]
      const records: FileRecord[] = Array.isArray(result) ? result : (result.data ?? [])
      paths = records.map(f => f.name)
    }

    const contextResults = await Promise.all(
      paths.map(async path => {
        try {
          const content = await r2Client.getObject(`projects/${projectId}/${path}`)
          return { path, content } as FileContext
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          logger.warn('ContextRetriever: could not fetch %s/%s: %s', projectId, path, message)
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
    })) as FindResult | FileRecord[]
    const files: FileRecord[] = Array.isArray(result) ? result : (result.data ?? [])

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
