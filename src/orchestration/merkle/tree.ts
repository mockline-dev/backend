import { hashContent, computeRootHash } from './hash'
import type { MerkleFileNode, MerkleTreeDocument, ChangeSet } from './types'

/** Build a fresh merkle tree document from raw file data. */
export function buildTree(
  projectId: string,
  files: Array<{ path: string; content: string; size: number }>
): MerkleTreeDocument {
  const nodes: MerkleFileNode[] = files.map(f => ({
    path: f.path,
    hash: hashContent(f.content),
    size: f.size
  }))

  return {
    projectId,
    rootHash: computeRootHash(nodes),
    files: nodes,
    fileCount: nodes.length,
    lastSyncAt: new Date(),
    version: 1
  }
}

/**
 * Diff two trees and return what changed.
 * If oldTree is null (first sync), every file in newTree is "added".
 */
export function diffTrees(oldTree: MerkleTreeDocument | null, newTree: MerkleTreeDocument): ChangeSet {
  const oldMap = new Map<string, string>()
  if (oldTree) {
    for (const f of oldTree.files) oldMap.set(f.path, f.hash)
  }

  const newMap = new Map<string, string>()
  for (const f of newTree.files) newMap.set(f.path, f.hash)

  const added: string[] = []
  const modified: string[] = []
  let unchanged = 0

  for (const [path, hash] of newMap) {
    if (!oldMap.has(path)) {
      added.push(path)
    } else if (oldMap.get(path) !== hash) {
      modified.push(path)
    } else {
      unchanged++
    }
  }

  const deleted: string[] = []
  for (const path of oldMap.keys()) {
    if (!newMap.has(path)) deleted.push(path)
  }

  return { added, modified, deleted, unchanged }
}

/**
 * Incrementally update an existing tree document with new file states.
 * Bumps version and refreshes lastSyncAt.
 */
export function updateTree(
  existing: MerkleTreeDocument,
  changedFiles: Array<{ path: string; content: string; size: number }>,
  deletedPaths: string[]
): MerkleTreeDocument {
  const deletedSet = new Set(deletedPaths)
  const changedMap = new Map(changedFiles.map(f => [f.path, { hash: hashContent(f.content), size: f.size }]))

  // Keep unchanged files, drop deleted
  const keptFiles = existing.files.filter(f => !deletedSet.has(f.path) && !changedMap.has(f.path))

  // Add/update changed files
  const updatedNodes: MerkleFileNode[] = [
    ...keptFiles,
    ...changedFiles.map(f => ({
      path: f.path,
      hash: changedMap.get(f.path)!.hash,
      size: changedMap.get(f.path)!.size
    }))
  ]

  return {
    ...existing,
    rootHash: computeRootHash(updatedNodes),
    files: updatedNodes,
    fileCount: updatedNodes.length,
    lastSyncAt: new Date(),
    version: existing.version + 1
  }
}
