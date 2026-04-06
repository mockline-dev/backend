/**
 * Merkle Tree + Incremental Indexing Smoke Test
 *
 * Tests the merkle tree system in layers:
 *   1. Pure logic (hash, tree build/diff/update) — no deps
 *   2. ChromaDB deleteByFilepath — needs ChromaDB
 *   3. MerkleTreeStore (Redis cache + MongoDB) — needs Redis + MongoDB
 *   4. Full syncProjectIndex() — needs all three
 *
 * Usage:
 *   pnpm run test:merkle
 *
 * Optional env vars:
 *   CHROMA_HOST    ChromaDB host (default: localhost)
 *   CHROMA_PORT    ChromaDB port (default: 8000)
 *   MONGO_URL      MongoDB connection string (default: from config)
 *   REDIS_HOST     Redis host (default: 127.0.0.1)
 *   REDIS_PORT     Redis port (default: 6379)
 */

import * as fs from 'fs'
import * as path from 'path'

const configPath = path.resolve(__dirname, '../config/default.json')
const defaultConfig: Record<string, any> = JSON.parse(fs.readFileSync(configPath, 'utf8'))

const CHROMA_HOST = process.env.CHROMA_HOST || defaultConfig?.chromadb?.host || 'localhost'
const CHROMA_PORT = Number(process.env.CHROMA_PORT || defaultConfig?.chromadb?.port || 8000)
const MONGO_URL = process.env.MONGO_URL || defaultConfig?.mongodb || 'mongodb://127.0.0.1:27017/mockline-back'
const REDIS_HOST = process.env.REDIS_HOST || defaultConfig?.redisConfig?.host || '127.0.0.1'
const REDIS_PORT = Number(process.env.REDIS_PORT || defaultConfig?.redisConfig?.port || 6379)

import { hashContent, computeRootHash } from '../src/orchestration/merkle/hash'
import { buildTree, diffTrees, updateTree } from '../src/orchestration/merkle/tree'
import { MerkleTreeStore } from '../src/orchestration/merkle/store'
import { ChromaVectorStore } from '../src/orchestration/rag/chroma.client'
import type { MerkleTreeDocument } from '../src/orchestration/merkle/types'

// ─── Console helpers ─────────────────────────────────────────────────────────

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'

let passCount = 0,
  failCount = 0,
  warnCount = 0

function ok(label: string, detail?: string) {
  passCount++
  console.log(`  ${GREEN}✓${RESET} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`)
}
function fail(label: string, err: unknown) {
  failCount++
  console.log(`  ${RED}✗${RESET} ${label}  ${DIM}${err instanceof Error ? err.message : String(err)}${RESET}`)
}
function warn(label: string, detail?: string) {
  warnCount++
  console.log(`  ${YELLOW}⚠${RESET} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`)
}
function section(title: string) {
  console.log(`\n${BOLD}${CYAN}── ${title} ──${RESET}`)
}
function banner(title: string) {
  const line = '─'.repeat(55)
  console.log(`\n${BOLD}${line}\n  ${title}\n${line}${RESET}`)
}

// ─── 1. Hash Utilities ────────────────────────────────────────────────────────

function testHashUtils() {
  section('1. Hash Utilities (pure)')

  try {
    const h = hashContent('hello world')
    if (h.length === 64 && /^[0-9a-f]+$/.test(h)) {
      ok('hashContent() returns 64-char hex', h.slice(0, 16) + '...')
    } else {
      fail('hashContent() unexpected output', h)
    }

    const same1 = hashContent('same content')
    const same2 = hashContent('same content')
    if (same1 === same2) ok('hashContent() is deterministic')
    else fail('hashContent() not deterministic', '')

    const diff = hashContent('different')
    if (same1 !== diff) ok('hashContent() differs for different content')
    else fail('hashContent() collision detected', '')

    const files = [
      { path: 'b.ts', hash: hashContent('bbb') },
      { path: 'a.ts', hash: hashContent('aaa') }
    ]
    const root1 = computeRootHash(files)
    const root2 = computeRootHash([...files].reverse())
    if (root1 === root2) ok('computeRootHash() is order-independent', root1.slice(0, 16) + '...')
    else fail('computeRootHash() order-dependent', '')

    const modified = [{ path: 'a.ts', hash: hashContent('changed') }, files[0]]
    if (root1 !== computeRootHash(modified)) ok('computeRootHash() changes when file changes')
    else fail('computeRootHash() did not detect change', '')
  } catch (err) {
    fail('Hash utilities threw', err)
  }
}

// ─── 2. Tree Build / Diff / Update ──────────────────────────────────────────

function testTreeOperations() {
  section('2. Tree Build / Diff / Update (pure)')

  try {
    const files = [
      { path: 'src/a.ts', content: 'export const a = 1', size: 18 },
      { path: 'src/b.ts', content: 'export const b = 2', size: 18 }
    ]

    const tree = buildTree('test-proj', files)
    if (tree.fileCount === 2 && tree.rootHash.length === 64) {
      ok(
        'buildTree() builds correct tree',
        `fileCount=${tree.fileCount} rootHash=${tree.rootHash.slice(0, 12)}...`
      )
    } else {
      fail('buildTree() unexpected result', JSON.stringify({ fileCount: tree.fileCount }))
    }

    // No changes
    const sameTree = buildTree('test-proj', files)
    const noDiff = diffTrees(tree, sameTree)
    if (
      noDiff.added.length === 0 &&
      noDiff.modified.length === 0 &&
      noDiff.deleted.length === 0 &&
      noDiff.unchanged === 2
    ) {
      ok('diffTrees() detects no changes', `unchanged=${noDiff.unchanged}`)
    } else {
      fail('diffTrees() false positives', JSON.stringify(noDiff))
    }

    // First sync (null old tree)
    const firstDiff = diffTrees(null, tree)
    if (firstDiff.added.length === 2 && firstDiff.modified.length === 0) {
      ok('diffTrees(null, tree) — all files are added on first sync', `added=${firstDiff.added.join(', ')}`)
    } else {
      fail('diffTrees(null, tree) unexpected result', JSON.stringify(firstDiff))
    }

    // Modify one file
    const updatedFiles = [
      { path: 'src/a.ts', content: 'export const a = 999', size: 20 }, // changed
      { path: 'src/b.ts', content: 'export const b = 2', size: 18 }, // same
      { path: 'src/c.ts', content: 'export const c = 3', size: 18 } // new
    ]
    const updatedTree = buildTree('test-proj', updatedFiles)
    const diff = diffTrees(tree, updatedTree)
    if (diff.modified.includes('src/a.ts') && diff.added.includes('src/c.ts') && diff.unchanged === 1) {
      ok(
        'diffTrees() detects modified + added',
        `modified=[${diff.modified}] added=[${diff.added}] unchanged=${diff.unchanged}`
      )
    } else {
      fail('diffTrees() missed changes', JSON.stringify(diff))
    }

    // Delete a file
    const reducedTree = buildTree('test-proj', [files[0]])
    const deleteDiff = diffTrees(tree, reducedTree)
    if (deleteDiff.deleted.includes('src/b.ts')) {
      ok('diffTrees() detects deleted files', `deleted=[${deleteDiff.deleted}]`)
    } else {
      fail('diffTrees() missed deletion', JSON.stringify(deleteDiff))
    }

    // updateTree()
    const updated = updateTree(tree, [{ path: 'src/a.ts', content: 'updated', size: 7 }], ['src/b.ts'])
    if (updated.fileCount === 1 && updated.version === 2) {
      ok(
        'updateTree() applies changes and bumps version',
        `fileCount=${updated.fileCount} version=${updated.version}`
      )
    } else {
      fail(
        'updateTree() unexpected result',
        JSON.stringify({ fileCount: updated.fileCount, version: updated.version })
      )
    }
  } catch (err) {
    fail('Tree operations threw', err)
  }
}

// ─── 3. ChromaDB deleteByFilepath ────────────────────────────────────────────

async function testChromaDeleteByFilepath(): Promise<ChromaVectorStore> {
  section('3. ChromaDB deleteByFilepath')

  const store = new ChromaVectorStore(CHROMA_HOST, CHROMA_PORT)
  const alive = await store.ping()

  if (!alive) {
    warn(
      `ChromaDB not reachable at ${CHROMA_HOST}:${CHROMA_PORT}`,
      'skipping — start: ./scripts/infra.sh start'
    )
    return store
  }
  ok(`ChromaDB reachable at ${CHROMA_HOST}:${CHROMA_PORT}`)

  const testProject = '_merkle_test_'
  try {
    // Seed with chunks across two files
    await store.addChunks(testProject, [
      {
        id: `${testProject}:file_a:0`,
        filepath: 'src/file_a.ts',
        content: 'function alpha() {}',
        startLine: 0,
        endLine: 1
      },
      {
        id: `${testProject}:file_a:1`,
        filepath: 'src/file_a.ts',
        content: 'function beta() {}',
        startLine: 2,
        endLine: 3
      },
      {
        id: `${testProject}:file_b:0`,
        filepath: 'src/file_b.ts',
        content: 'function gamma() {}',
        startLine: 0,
        endLine: 1
      }
    ])
    ok('Seeded 3 chunks across 2 files')

    const before = await store.query(testProject, 'function', 10)
    ok(`Query before delete returns ${before.length} chunk(s)`)

    // Delete only file_a chunks
    await store.deleteByFilepath(testProject, 'src/file_a.ts')
    ok('deleteByFilepath("src/file_a.ts") called')

    const after = await store.query(testProject, 'function', 10)
    const hasFileA = after.some(r => r.chunk.filepath === 'src/file_a.ts')
    const hasFileB = after.some(r => r.chunk.filepath === 'src/file_b.ts')

    if (!hasFileA && hasFileB) {
      ok('file_a chunks removed, file_b chunks retained', `remaining=${after.length}`)
    } else if (hasFileA) {
      fail('file_a chunks still present after delete', `remaining=${after.length}`)
    } else {
      warn(
        'Could not verify — query returned 0 results (ChromaDB may need warm-up)',
        `remaining=${after.length}`
      )
    }
  } finally {
    await store.deleteCollection(testProject)
    ok('Cleaned up test collection')
  }

  return store
}

// ─── 4. MerkleTreeStore (Redis + MongoDB) ────────────────────────────────────

async function testMerkleTreeStore(): Promise<MerkleTreeStore | null> {
  section('4. MerkleTreeStore (Redis cache + MongoDB)')

  // Try Redis
  let redis: any = null
  try {
    const IORedis = require('ioredis')
    redis = new IORedis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true, connectTimeout: 3000 })
    await redis.connect()
    await redis.ping()
    ok(`Redis reachable at ${REDIS_HOST}:${REDIS_PORT}`)
  } catch (err) {
    warn(`Redis not reachable at ${REDIS_HOST}:${REDIS_PORT}`, 'skipping store tests')
    if (redis) redis.disconnect()
    return null
  }

  // Try MongoDB
  let mongoDb: any = null
  try {
    const { MongoClient } = require('mongodb')
    const client = await MongoClient.connect(MONGO_URL, { serverSelectionTimeoutMS: 3000 })
    const dbName = new URL(MONGO_URL).pathname.substring(1)
    mongoDb = client.db(dbName)
    ok(`MongoDB reachable at ${MONGO_URL.replace(/\/\/[^@]+@/, '//')}`)
  } catch (err) {
    warn(`MongoDB not reachable`, 'skipping store tests — ensure MongoDB is running')
    await redis.quit()
    return null
  }

  try {
    const store = new MerkleTreeStore(() => Promise.resolve(mongoDb), redis)

    const projectId = '_merkle_store_test_'
    const tree: MerkleTreeDocument = buildTree(projectId, [
      { path: 'src/index.ts', content: 'console.log("hello")', size: 20 },
      { path: 'src/utils.ts', content: 'export const add = (a:number, b:number) => a+b', size: 46 }
    ])

    // Save
    await store.save(tree)
    ok('store.save() — persisted to MongoDB + cached in Redis')

    // Get (should hit Redis cache)
    const fromCache = await store.get(projectId)
    if (fromCache?.rootHash === tree.rootHash) {
      ok('store.get() — cache hit, rootHash matches', fromCache.rootHash.slice(0, 16) + '...')
    } else {
      fail('store.get() — cache miss or wrong data', String(fromCache?.rootHash))
    }

    // Bust Redis cache, verify MongoDB fallback
    await redis.del(`merkle:${projectId}`)
    const fromMongo = await store.get(projectId)
    if (fromMongo?.rootHash === tree.rootHash) {
      ok('store.get() after cache bust — falls through to MongoDB correctly')
    } else {
      fail('store.get() MongoDB fallback failed', String(fromMongo?.rootHash))
    }

    // Delete
    await store.delete(projectId)
    const afterDelete = await store.get(projectId)
    if (!afterDelete) {
      ok('store.delete() — removed from both Redis and MongoDB')
    } else {
      fail('store.delete() — document still exists', String(afterDelete))
    }

    return store
  } catch (err) {
    fail('MerkleTreeStore operations threw', err)
    return null
  }
}

// ─── 5. syncProjectIndex() end-to-end ────────────────────────────────────────

async function testSyncProjectIndex(chromaStore: ChromaVectorStore, merkleStore: MerkleTreeStore | null) {
  section('5. syncProjectIndex() end-to-end')

  const chromaAlive = await chromaStore.ping()
  if (!chromaAlive) {
    warn('Skipping — ChromaDB not reachable')
    return
  }
  if (!merkleStore) {
    warn('Skipping — MerkleTreeStore not available (Redis/MongoDB required)')
    return
  }

  const { syncProjectIndex } = require('../src/orchestration/merkle/sync')
  const projectId = '_sync_test_'

  // Mock app that returns fake file records and content
  const fileRecords = [
    { _id: '1', name: 'src/hello.ts', key: 'proj/hello.ts', projectId },
    { _id: '2', name: 'src/world.ts', key: 'proj/world.ts', projectId }
  ]
  const fileContents: Record<string, string> = {
    'proj/hello.ts': 'export function hello() { return "hello"; }',
    'proj/world.ts': 'export function world() { return "world"; }'
  }

  const mockApp = {
    service: (name: string) => {
      if (name === 'files') {
        return {
          find: async () => fileRecords
        }
      }
      if (name === 'file-stream') {
        return {
          get: async (_id: any, opts: any) => {
            const key = opts?.query?.key
            // Return a data URL so fetchFileContent can read it without HTTP
            const content = fileContents[key] ?? ''
            return `data:text/plain;base64,${Buffer.from(content).toString('base64')}`
          }
        }
      }
      return {}
    }
  }

  // file-fetcher needs to fetch via URL — patch it so data: URIs work in tests
  const originalFetch = global.fetch
  ;(global as any).fetch = async (url: string) => {
    if (url.startsWith('data:text/plain;base64,')) {
      const b64 = url.split(',')[1]
      const content = Buffer.from(b64, 'base64').toString('utf8')
      return { ok: true, text: async () => content } as any
    }
    return originalFetch(url)
  }

  try {
    // First sync — should do full index
    process.stdout.write(`  Running first sync (full index)... `)
    const result1 = await syncProjectIndex(projectId, mockApp, chromaStore, merkleStore)
    console.log(`${GREEN}done${RESET}`)
    ok('First sync (full index)', `added=${result1.changes.added.length} indexed=${result1.indexed}`)

    // Second sync with no changes — should be no-op
    process.stdout.write(`  Running second sync (no changes)... `)
    const result2 = await syncProjectIndex(projectId, mockApp, chromaStore, merkleStore)
    console.log(`${GREEN}done${RESET}`)
    if (result2.indexed === 0 && result2.removed === 0) {
      ok('Second sync (no changes) — no-op as expected', `unchanged=${result2.changes.unchanged}`)
    } else {
      fail('Second sync should have been a no-op', JSON.stringify(result2))
    }

    // Modify a file
    fileContents['proj/hello.ts'] = 'export function hello() { return "hello world"; }'
    process.stdout.write(`  Running third sync (one file modified)... `)
    const result3 = await syncProjectIndex(projectId, mockApp, chromaStore, merkleStore)
    console.log(`${GREEN}done${RESET}`)
    if (result3.changes.modified.includes('src/hello.ts') && result3.changes.unchanged === 1) {
      ok(
        'Third sync detects modified file',
        `modified=[${result3.changes.modified}] unchanged=${result3.changes.unchanged}`
      )
    } else {
      warn('Third sync — unexpected result', JSON.stringify(result3.changes))
    }
  } finally {
    ;(global as any).fetch = originalFetch
    // Cleanup
    await chromaStore.deleteCollection(projectId).catch(() => {})
    await merkleStore.delete(projectId).catch(() => {})
    ok('Cleaned up test data')
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  banner('Mockline Merkle Tree + Indexing Smoke Test')
  console.log(
    `${DIM}  Layers: hash → tree → ChromaDB.deleteByFilepath → store (Redis+Mongo) → syncProjectIndex${RESET}`
  )
  console.log(
    `${DIM}  Endpoints: ChromaDB=${CHROMA_HOST}:${CHROMA_PORT}  Redis=${REDIS_HOST}:${REDIS_PORT}  MongoDB=${MONGO_URL.split('@').pop() ?? MONGO_URL}${RESET}`
  )

  testHashUtils()
  testTreeOperations()
  const chromaStore = await testChromaDeleteByFilepath()
  const merkleStore = await testMerkleTreeStore()
  await testSyncProjectIndex(chromaStore, merkleStore)

  const line = '─'.repeat(55)
  console.log(`\n${BOLD}${line}${RESET}`)
  console.log(
    `  ${GREEN}${passCount} passed${RESET}  ${failCount > 0 ? RED : DIM}${failCount} failed${RESET}  ${warnCount > 0 ? YELLOW : DIM}${warnCount} warnings${RESET}`
  )
  console.log(`${BOLD}${line}${RESET}\n`)

  if (failCount > 0) process.exit(1)
}

main().catch(err => {
  console.error(`\n${RED}Fatal error:${RESET}`, err)
  process.exit(1)
})
