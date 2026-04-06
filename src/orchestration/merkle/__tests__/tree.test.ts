import { describe, it, expect } from 'vitest'
import { buildTree, diffTrees, updateTree } from '../tree'

const makeFiles = (entries: Array<[string, string]>) =>
  entries.map(([path, content]) => ({ path, content, size: content.length }))

describe('buildTree', () => {
  it('builds a tree with correct file count', () => {
    const tree = buildTree(
      'proj1',
      makeFiles([
        ['src/a.ts', 'aaa'],
        ['src/b.ts', 'bbb']
      ])
    )
    expect(tree.fileCount).toBe(2)
    expect(tree.files).toHaveLength(2)
    expect(tree.projectId).toBe('proj1')
    expect(tree.version).toBe(1)
  })

  it('generates a non-empty root hash', () => {
    const tree = buildTree('proj1', makeFiles([['a.ts', 'hello']]))
    expect(tree.rootHash).toHaveLength(64)
  })

  it('produces same root hash for same content regardless of input order', () => {
    const t1 = buildTree(
      'p',
      makeFiles([
        ['a.ts', 'aa'],
        ['b.ts', 'bb']
      ])
    )
    const t2 = buildTree(
      'p',
      makeFiles([
        ['b.ts', 'bb'],
        ['a.ts', 'aa']
      ])
    )
    expect(t1.rootHash).toBe(t2.rootHash)
  })

  it('handles empty file list', () => {
    const tree = buildTree('p', [])
    expect(tree.fileCount).toBe(0)
    expect(tree.files).toHaveLength(0)
  })
})

describe('diffTrees', () => {
  it('treats all files as added when oldTree is null', () => {
    const newTree = buildTree(
      'p',
      makeFiles([
        ['a.ts', 'aa'],
        ['b.ts', 'bb']
      ])
    )
    const diff = diffTrees(null, newTree)
    expect(diff.added).toContain('a.ts')
    expect(diff.added).toContain('b.ts')
    expect(diff.modified).toHaveLength(0)
    expect(diff.deleted).toHaveLength(0)
  })

  it('detects no changes when trees are identical', () => {
    const tree = buildTree('p', makeFiles([['a.ts', 'aa']]))
    const diff = diffTrees(tree, buildTree('p', makeFiles([['a.ts', 'aa']])))
    expect(diff.added).toHaveLength(0)
    expect(diff.modified).toHaveLength(0)
    expect(diff.deleted).toHaveLength(0)
    expect(diff.unchanged).toBe(1)
  })

  it('detects modified files', () => {
    const old = buildTree('p', makeFiles([['a.ts', 'old']]))
    const next = buildTree('p', makeFiles([['a.ts', 'new']]))
    const diff = diffTrees(old, next)
    expect(diff.modified).toContain('a.ts')
    expect(diff.added).toHaveLength(0)
    expect(diff.deleted).toHaveLength(0)
  })

  it('detects deleted files', () => {
    const old = buildTree(
      'p',
      makeFiles([
        ['a.ts', 'aa'],
        ['b.ts', 'bb']
      ])
    )
    const next = buildTree('p', makeFiles([['a.ts', 'aa']]))
    const diff = diffTrees(old, next)
    expect(diff.deleted).toContain('b.ts')
    expect(diff.unchanged).toBe(1)
  })

  it('detects added files', () => {
    const old = buildTree('p', makeFiles([['a.ts', 'aa']]))
    const next = buildTree(
      'p',
      makeFiles([
        ['a.ts', 'aa'],
        ['b.ts', 'bb']
      ])
    )
    const diff = diffTrees(old, next)
    expect(diff.added).toContain('b.ts')
    expect(diff.unchanged).toBe(1)
  })
})

describe('updateTree', () => {
  it('bumps version on update', () => {
    const tree = buildTree('p', makeFiles([['a.ts', 'aa']]))
    const updated = updateTree(tree, makeFiles([['a.ts', 'bb']]), [])
    expect(updated.version).toBe(2)
  })

  it('removes deleted paths', () => {
    const tree = buildTree(
      'p',
      makeFiles([
        ['a.ts', 'aa'],
        ['b.ts', 'bb']
      ])
    )
    const updated = updateTree(tree, [], ['b.ts'])
    expect(updated.files.map(f => f.path)).not.toContain('b.ts')
    expect(updated.fileCount).toBe(1)
  })

  it('updates content of existing files', () => {
    const tree = buildTree('p', makeFiles([['a.ts', 'old']]))
    const updated = updateTree(tree, makeFiles([['a.ts', 'new']]), [])
    const node = updated.files.find(f => f.path === 'a.ts')!
    expect(node.hash).not.toBe(tree.files[0].hash)
  })

  it('adds new files', () => {
    const tree = buildTree('p', makeFiles([['a.ts', 'aa']]))
    const updated = updateTree(tree, makeFiles([['b.ts', 'bb']]), [])
    expect(updated.files.map(f => f.path)).toContain('b.ts')
    expect(updated.fileCount).toBe(2)
  })

  it('recomputes root hash after update', () => {
    const tree = buildTree('p', makeFiles([['a.ts', 'old']]))
    const updated = updateTree(tree, makeFiles([['a.ts', 'new']]), [])
    expect(updated.rootHash).not.toBe(tree.rootHash)
  })
})
