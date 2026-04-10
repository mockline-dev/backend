import { createModuleLogger } from '../../logging'
import { chunkText } from '../chunking/text.chunker'
import { chunkCode, initTreeSitter, isCodeFile } from '../chunking/tree-sitter.chunker'
import type { ChromaVectorStore } from './chroma.client'
import { fetchFileContent } from './file-fetcher'

const log = createModuleLogger('rag-indexer')

interface FileRecord {
  _id: string
  name: string
  key: string
  projectId: string
}

/**
 * Indexes all files for a project into ChromaDB.
 *
 * Flow:
 *   1. List files from MongoDB via FeathersJS files service
 *   2. Fetch content from R2 via file-stream service
 *   3. Chunk via tree-sitter (code) or text chunker (other)
 *   4. Upsert chunks into ChromaDB
 *
 * Safe to call repeatedly — uses upsert semantics.
 */
export async function indexProjectFiles(
  projectId: string,
  app: { service: (name: string) => any },
  vectorStore: ChromaVectorStore
): Promise<{ indexed: number; failed: number }> {
  await initTreeSitter()

  let indexed = 0
  let failed = 0

  try {
    const filesService = app.service('files')
    const result = await filesService.find({
      query: { projectId, $limit: 200 },
      paginate: false
    })
    const files: FileRecord[] = Array.isArray(result) ? result : (result.data ?? [])

    if (files.length === 0) {
      log.debug('No files to index', { projectId })
      return { indexed: 0, failed: 0 }
    }

    log.info('Indexing project files', { projectId, count: files.length })

    const BATCH_SIZE = 10
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE)
      await Promise.all(
        batch.map(async file => {
          try {
            const content = await fetchFileContent(file.key, app)
            if (!content) return

            const chunks = isCodeFile(file.name)
              ? await chunkCode(content, file.name)
              : chunkText(content, file.name)

            const prefixedChunks = chunks.map(c => ({
              ...c,
              id: `${projectId}:${c.id}`
            }))

            await vectorStore.addChunks(projectId, prefixedChunks)
            indexed++
          } catch (err: unknown) {
            failed++
            log.warn('Failed to index file', {
              file: file.name,
              error: err instanceof Error ? err.message : String(err)
            })
          }
        })
      )
    }

    log.info('Indexing complete', { projectId, indexed, failed })
  } catch (err: unknown) {
    log.error('Project indexing failed', {
      projectId,
      error: err instanceof Error ? err.message : String(err)
    })
  }

  return { indexed, failed }
}
