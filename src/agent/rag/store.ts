import { embed, cosineSimilarity } from '../../llm/embeddings'
import { logger } from '../../logger'

interface FileEntry {
  path: string
  vector: number[]
  contentPreview: string
}

/**
 * Per-project in-memory embedding store.
 * Holds file vectors for semantic similarity search.
 * Re-indexes when files are written via agent tools or after rollback.
 */
class EmbeddingStore {
  private projects = new Map<string, FileEntry[]>()

  async add(projectId: string, path: string, content: string): Promise<void> {
    try {
      const vector = await embed(content)
      const entries = this.projects.get(projectId) ?? []
      // Replace existing entry for same path
      const idx = entries.findIndex(e => e.path === path)
      const entry: FileEntry = { path, vector, contentPreview: content.slice(0, 200) }
      if (idx >= 0) {
        entries[idx] = entry
      } else {
        entries.push(entry)
      }
      this.projects.set(projectId, entries)
    } catch (err: any) {
      logger.warn('EmbeddingStore: failed to index %s/%s: %s', projectId, path, err.message)
    }
  }

  async query(projectId: string, queryText: string, topK = 5): Promise<string[]> {
    const entries = this.projects.get(projectId)
    if (!entries || entries.length === 0) return []

    let queryVec: number[]
    try {
      queryVec = await embed(queryText)
    } catch {
      return []
    }

    const scored = entries.map(e => ({
      path: e.path,
      score: cosineSimilarity(queryVec, e.vector)
    }))

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK).map(e => e.path)
  }

  remove(projectId: string, path: string): void {
    const entries = this.projects.get(projectId)
    if (!entries) return
    const idx = entries.findIndex(e => e.path === path)
    if (idx >= 0) {
      entries.splice(idx, 1)
      this.projects.set(projectId, entries)
    }
  }

  clear(projectId: string): void {
    this.projects.delete(projectId)
  }

  has(projectId: string): boolean {
    return this.projects.has(projectId) && (this.projects.get(projectId)?.length ?? 0) > 0
  }
}

export const embeddingStore = new EmbeddingStore()
