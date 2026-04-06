import { createHash } from 'crypto'
import type { MerkleFileNode } from './types'

/** SHA-256 hex digest of arbitrary string content */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Deterministic root hash for a set of files.
 * Files are sorted by path before hashing so insertion order doesn't matter.
 */
export function computeRootHash(files: Array<Pick<MerkleFileNode, 'path' | 'hash'>>): string {
  if (files.length === 0) return hashContent('')
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  const combined = sorted.map((f) => `${f.path}:${f.hash}`).join('\n')
  return hashContent(combined)
}
