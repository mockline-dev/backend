// ─── Merkle Tree Types ───────────────────────────────────────────────────────

export interface MerkleFileNode {
  /** Relative file path, e.g. "src/index.ts" */
  path: string
  /** SHA-256 hex digest of file content */
  hash: string
  /** File size in bytes */
  size: number
}

export interface MerkleTreeDocument {
  _id?: string
  projectId: string
  /** SHA-256 of all sorted `path:hash` entries concatenated */
  rootHash: string
  files: MerkleFileNode[]
  fileCount: number
  lastSyncAt: Date
  /** Optimistic concurrency counter, incremented on every save */
  version: number
}

export interface ChangeSet {
  added: string[] // paths new in current tree
  modified: string[] // paths present in both trees with different hash
  deleted: string[] // paths present in old tree but not new
  unchanged: number // count of files with identical hash
}
