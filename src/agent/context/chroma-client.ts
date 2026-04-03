import config from 'config'

import { llmClient } from '../../llm/client'
import { logger } from '../../logger'
import type { GeneratedFile } from '../../types'
import type { TreeSitterIndexer } from './tree-sitter-indexer'

// ─── Config ───────────────────────────────────────────────────────────────────

interface ChromaDbConfig {
  host: string
  port: number
  collection: string
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface ChromaSearchResult {
  filepath: string
  content: string
  score: number
}

// ─── Minimal shapes for chromadb v3 API (compatible with actual library) ──────

/* eslint-disable @typescript-eslint/no-explicit-any */
type ChromaCollection = {
  upsert(args: {
    ids: string[]
    embeddings: number[][]
    documents: string[]
    metadatas: Record<string, string | number | boolean>[]
  }): Promise<unknown>
  query(args: { queryEmbeddings: number[][]; nResults: number; include?: string[] }): Promise<{
    ids: string[][]
    documents: (string | null)[][] | null
    distances: number[][] | null
    metadatas: (Record<string, string | number | boolean> | null)[][] | null
  }>
  delete(args: { ids: string[] }): Promise<unknown>
}

type ChromaBaseClient = {
  heartbeat(): Promise<number>
  getOrCreateCollection(args: { name: string; embeddingFunction: null }): Promise<ChromaCollection>
  deleteCollection(args: { name: string }): Promise<unknown>
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Chunk splitting ──────────────────────────────────────────────────────────

interface Chunk {
  id: string
  content: string
  filepath: string
  startLine: number
  endLine: number
}

function splitByBoundaries(filepath: string, content: string, indexer: TreeSitterIndexer | null): Chunk[] {
  const lines = content.split('\n')
  const chunks: Chunk[] = []

  if (indexer && filepath.endsWith('.py')) {
    const index = indexer.indexFile('__chunking__', filepath, content)
    const boundaries = [...index.functions.map(f => f.line), ...index.classes.map(c => c.line)].sort(
      (a, b) => a - b
    )

    if (boundaries.length === 0) {
      return splitByDoubleNewlines(filepath, content)
    }

    let prev = 0
    for (const boundary of boundaries) {
      const end = boundary - 1
      if (end > prev) {
        const slice = lines.slice(prev, end).join('\n').trim()
        if (slice.length > 20) {
          chunks.push({
            id: `${filepath}::${prev}`,
            content: slice,
            filepath,
            startLine: prev + 1,
            endLine: end
          })
        }
      }
      prev = boundary - 1
    }
    // Remainder
    if (prev < lines.length) {
      const slice = lines.slice(prev).join('\n').trim()
      if (slice.length > 20) {
        chunks.push({
          id: `${filepath}::${prev}`,
          content: slice,
          filepath,
          startLine: prev + 1,
          endLine: lines.length
        })
      }
    }
    return chunks.length > 0 ? chunks : splitByDoubleNewlines(filepath, content)
  }

  return splitByDoubleNewlines(filepath, content)
}

function splitByDoubleNewlines(filepath: string, content: string): Chunk[] {
  const blocks = content.split(/\n{2,}/)
  const chunks: Chunk[] = []
  let lineOffset = 0

  for (const block of blocks) {
    const trimmed = block.trim()
    if (trimmed.length > 20) {
      const blockLines = block.split('\n').length
      chunks.push({
        id: `${filepath}::${lineOffset}`,
        content: trimmed,
        filepath,
        startLine: lineOffset + 1,
        endLine: lineOffset + blockLines
      })
    }
    lineOffset += block.split('\n').length + 2
  }
  return chunks
}

// ─── ChromaClient ─────────────────────────────────────────────────────────────

/**
 * Thin wrapper around the ChromaDB JavaScript client.
 *
 * Handles ChromaDB being unavailable gracefully:
 * - Connection failures are logged as warnings, not errors
 * - All methods return empty results when ChromaDB is unavailable
 * - The system works perfectly without ChromaDB (it's an enhancement)
 */
export class ChromaClient {
  private readonly host: string
  private readonly port: number
  private client: ChromaBaseClient | null = null
  private available = true

  constructor() {
    const cfg = config.get<ChromaDbConfig>('chromadb')
    this.host = cfg.host ?? 'localhost'
    this.port = cfg.port ?? 8001
  }

  private collectionName(projectId: string): string {
    return `mockline-${projectId}`
  }

  private async getClient(): Promise<ChromaBaseClient | null> {
    if (!this.available) return null
    if (this.client) return this.client

    try {
      // Dynamic import to avoid crash if chromadb package is not installed
      const chromaModule = await import('chromadb')
      const BaseClient = chromaModule.ChromaClient as unknown as new (config: {
        ssl: boolean
        host: string
        port: number
      }) => ChromaBaseClient
      const c = new BaseClient({
        ssl: false,
        host: this.host,
        port: this.port
      })
      await c.heartbeat()
      this.client = c
      logger.info('ChromaClient: connected to ChromaDB at %s:%d', this.host, this.port)
      return this.client
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('ChromaClient: ChromaDB unavailable (%s) — semantic search disabled', msg)
      this.available = false
      return null
    }
  }

  private async getOrCreateCollection(projectId: string): Promise<ChromaCollection | null> {
    const client = await this.getClient()
    if (!client) return null
    try {
      // embeddingFunction: null — we supply embeddings manually via llmClient.embed()
      return await client.getOrCreateCollection({ name: this.collectionName(projectId), embeddingFunction: null })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('ChromaClient: getOrCreateCollection failed: %s', msg)
      return null
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async indexProject(
    projectId: string,
    files: GeneratedFile[],
    indexer: TreeSitterIndexer | null = null
  ): Promise<void> {
    const collection = await this.getOrCreateCollection(projectId)
    if (!collection) return

    const pyFiles = files.filter(f => f.path.endsWith('.py'))

    for (const file of pyFiles) {
      const chunks = splitByBoundaries(file.path, file.content, indexer)
      if (chunks.length === 0) continue

      try {
        const embeddings = await Promise.all(chunks.map(c => llmClient.embed(c.content)))

        await collection.upsert({
          ids: chunks.map(c => c.id),
          embeddings,
          documents: chunks.map(c => c.content),
          metadatas: chunks.map(c => ({
            filepath: c.filepath,
            startLine: c.startLine,
            endLine: c.endLine
          }))
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.warn('ChromaClient: failed to index %s: %s', file.path, msg)
      }
    }

    logger.info('ChromaClient: indexed %d Python files for project %s', pyFiles.length, projectId)
  }

  async search(projectId: string, query: string, limit = 5): Promise<ChromaSearchResult[]> {
    const collection = await this.getOrCreateCollection(projectId)
    if (!collection) return []

    try {
      const embedding = await llmClient.embed(query)
      const results = await collection.query({
        queryEmbeddings: [embedding],
        nResults: limit,
        include: ['documents', 'distances', 'metadatas']
      })

      const ids = results.ids[0] ?? []
      const docs = results.documents?.[0] ?? []
      const distances = results.distances?.[0] ?? []
      const metas = results.metadatas?.[0] ?? []

      return ids.map((id, i) => {
        const meta = metas[i]
        const filepath = meta && typeof meta.filepath === 'string' ? meta.filepath : id
        const content = docs[i] ?? ''
        const dist = distances[i] ?? 1
        return { filepath, content, score: 1 - dist }
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('ChromaClient: search failed: %s', msg)
      return []
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    const client = await this.getClient()
    if (!client) return
    try {
      await client.deleteCollection({ name: this.collectionName(projectId) })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('ChromaClient: deleteProject failed: %s', msg)
    }
  }

  /** Heartbeat check for startup diagnostics. */
  async ping(): Promise<boolean> {
    const client = await this.getClient()
    if (!client) return false
    try {
      await client.heartbeat()
      return true
    } catch {
      return false
    }
  }
}

export const chromaClient = new ChromaClient()
