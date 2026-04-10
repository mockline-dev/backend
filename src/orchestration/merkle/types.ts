export interface MerkleFileNode {
  path: string
  hash: string
  size: number
}

export interface MerkleTreeDocument {
  _id?: string
  projectId: string
  rootHash: string
  files: MerkleFileNode[]
  fileCount: number
  lastSyncAt: Date
  version: number
}

export interface ChangeSet {
  added: string[]
  modified: string[]
  deleted: string[]
  unchanged: number
}
