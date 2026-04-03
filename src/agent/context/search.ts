import { logger } from '../../logger'
import { r2Client } from '../../storage/r2.client'
import type { GeneratedFile } from '../../types'
import type { Application } from '../../declarations'
import type { MocklineChromaClient } from './chroma-client'
import { grepSearch } from './grep-search'
import type { SearchResult } from './grep-search'

// Re-export so callers have a single import point
export type { SearchResult }

// ─── CodeSearchService ────────────────────────────────────────────────────────

/**
 * Unified search — ChromaDB semantic search with grep fallback.
 *
 * When ChromaDB is available and returns results, those are used.
 * Otherwise, files are loaded from R2 and keyword-scored via grepSearch().
 */
export class CodeSearchService {
  constructor(
    private readonly chromaClient: MocklineChromaClient | null,
    private readonly app: Application
  ) {}

  async search(projectId: string, query: string, limit = 5): Promise<SearchResult[]> {
    if (this.chromaClient?.isAvailable()) {
      try {
        const results = await this.chromaClient.search(projectId, query, limit)
        if (results.length > 0) {
          return results.map(r => ({ ...r, source: 'chromadb' as const }))
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.warn('CodeSearchService: ChromaDB search error, falling back to grep: %s', msg)
      }
    }

    return this.grepFallback(projectId, query, limit)
  }

  async indexProject(projectId: string, files: GeneratedFile[]): Promise<void> {
    if (!this.chromaClient?.isAvailable()) return
    await this.chromaClient.indexProject(projectId, files)
  }

  async indexFile(projectId: string, filepath: string, content: string): Promise<void> {
    if (!this.chromaClient?.isAvailable()) return
    await this.chromaClient.indexFile(projectId, filepath, content)
  }

  async deleteProject(projectId: string): Promise<void> {
    if (!this.chromaClient?.isAvailable()) return
    await this.chromaClient.deleteProject(projectId)
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async grepFallback(
    projectId: string,
    query: string,
    limit: number
  ): Promise<SearchResult[]> {
    logger.debug('CodeSearchService: grep fallback for project %s', projectId)

    const files = new Map<string, string>()
    const prefix = `projects/${projectId}/`

    try {
      const objects = await r2Client.listObjects(prefix)
      const pyPaths = objects
        .map(o => o.key.replace(prefix, ''))
        .filter(p => p.endsWith('.py'))
        .slice(0, 50)

      await Promise.all(
        pyPaths.map(async path => {
          try {
            const content = await r2Client.getObject(`${prefix}${path}`)
            files.set(path, content)
          } catch {
            // Skip inaccessible files
          }
        })
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('CodeSearchService: failed to load files for grep: %s', msg)
    }

    return grepSearch(files, query, limit)
  }
}
