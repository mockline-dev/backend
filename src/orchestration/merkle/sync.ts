import { createModuleLogger } from '../../logging'
import { chunkCode, initTreeSitter, isCodeFile } from '../chunking/tree-sitter.chunker'
import { chunkText } from '../chunking/text.chunker'
import { indexProjectFiles } from '../rag/indexer'
import { fetchFileContent } from '../rag/file-fetcher'
import type { ChromaVectorStore } from '../rag/chroma.client'
import { buildTree, diffTrees } from './tree'
import type { MerkleTreeStore } from './store'
import type { ChangeSet } from './types'

const log = createModuleLogger('merkle-sync')

interface FileRecord {
  _id: string
  name: string
  key: string
  projectId: string
}

/**
 * Incrementally sync a project's ChromaDB index using Merkle tree change detection.
 *
 * - First run: full index via existing indexProjectFiles(), then saves tree
 * - Subsequent runs: only re-indexes files that changed (added/modified/deleted)
 * - If root hashes match: no-op (returns 0 changes)
 */
export async function syncProjectIndex(
  projectId: string,
  app: any,
  vectorStore: ChromaVectorStore,
  store: MerkleTreeStore
): Promise<{ changes: ChangeSet; indexed: number; removed: number }> {
  await initTreeSitter()

  const noChanges: ChangeSet = { added: [], modified: [], deleted: [], unchanged: 0 }

  // Fetch all file records from MongoDB
  let files: FileRecord[] = []
  try {
    const result = await app.service('files').find({
      query: { projectId, $limit: 200 },
      paginate: false,
    })
    files = Array.isArray(result) ? result : result.data ?? []
  } catch (err) {
    log.error('Failed to fetch file records', { projectId, error: err instanceof Error ? err.message : String(err) })
    return { changes: noChanges, indexed: 0, removed: 0 }
  }

  if (files.length === 0) {
    log.debug('No files to sync', { projectId })
    return { changes: noChanges, indexed: 0, removed: 0 }
  }

  // Fetch all file contents
  const fileContents = await Promise.all(
    files.map(async (f) => {
      const content = await fetchFileContent(f.key, app)
      return { file: f, content }
    })
  )
  const available = fileContents.filter((fc) => fc.content !== null) as Array<{
    file: FileRecord
    content: string
  }>

  // Build new tree from current state
  const newTree = buildTree(
    projectId,
    available.map((fc) => ({ path: fc.file.name, content: fc.content, size: fc.content.length }))
  )

  // Load existing tree
  const oldTree = await store.get(projectId)

  // First sync — full index
  if (!oldTree) {
    log.info('First sync: running full index', { projectId, fileCount: available.length })
    const { indexed } = await indexProjectFiles(projectId, app, vectorStore)
    newTree.version = 1
    await store.save(newTree)
    const changes: ChangeSet = {
      added: available.map((fc) => fc.file.name),
      modified: [],
      deleted: [],
      unchanged: 0,
    }
    return { changes, indexed, removed: 0 }
  }

  // Root hash match — nothing to do
  if (oldTree.rootHash === newTree.rootHash) {
    log.debug('No changes detected', { projectId, rootHash: newTree.rootHash })
    return { changes: { ...noChanges, unchanged: newTree.fileCount }, indexed: 0, removed: 0 }
  }

  // Diff the trees
  const changes = diffTrees(oldTree, newTree)
  log.info('Sync detected changes', {
    projectId,
    added: changes.added.length,
    modified: changes.modified.length,
    deleted: changes.deleted.length,
  })

  let indexed = 0
  let removed = 0

  // Delete chunks for removed/modified files
  const toRemove = [...changes.deleted, ...changes.modified]
  for (const filepath of toRemove) {
    await vectorStore.deleteByFilepath(projectId, filepath)
    removed++
  }

  // Re-index added and modified files
  const toIndex = [...changes.added, ...changes.modified]
  const contentMap = new Map(available.map((fc) => [fc.file.name, { content: fc.content, file: fc.file }]))

  const BATCH_SIZE = 10
  for (let i = 0; i < toIndex.length; i += BATCH_SIZE) {
    const batch = toIndex.slice(i, i + BATCH_SIZE)
    await Promise.all(
      batch.map(async (filepath) => {
        const entry = contentMap.get(filepath)
        if (!entry) return
        try {
          const chunks = isCodeFile(entry.file.name)
            ? await chunkCode(entry.content, entry.file.name)
            : chunkText(entry.content, entry.file.name)

          const prefixed = chunks.map((c) => ({ ...c, id: `${projectId}:${c.id}` }))
          await vectorStore.addChunks(projectId, prefixed)
          indexed++
        } catch (err) {
          log.warn('Failed to re-index file', {
            filepath,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })
    )
  }

  // Save updated tree
  newTree.version = oldTree.version + 1
  await store.save(newTree)

  log.info('Sync complete', { projectId, indexed, removed })
  return { changes, indexed, removed }
}
