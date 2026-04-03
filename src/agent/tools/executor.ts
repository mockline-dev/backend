import { execFileSync } from 'child_process'
import { unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

import type { Application } from '../../declarations'
import { r2Client } from '../../storage/r2.client'
import { embeddingStore } from '../rag/store'
import { symbolIndexer } from '../rag/symbol-indexer'
import { treeSitterIndexer } from '../context/tree-sitter-indexer'
import { chromaClient } from '../context/chroma-client'
import { CodeSearchService } from '../context/search'

export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}


export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  projectId: string,
  app: Application
): Promise<ToolResult> {
  const prefix = `projects/${projectId}/`

  try {
    switch (name) {
      case 'read_file': {
        const path = normalizeProjectPath(args.path)
        if (!path) return { success: false, error: 'Invalid path' }
        const content = await r2Client.getObject(`${prefix}${path}`)
        return { success: true, data: { path, content } }
      }

      case 'create_file':
      case 'write_file': {
        const path = normalizeProjectPath(args.path)
        if (!path) return { success: false, error: 'Invalid path' }
        if (typeof args.content !== 'string') {
          return { success: false, error: 'Invalid content: expected string' }
        }

        const maxBytes = 5 * 1024 * 1024
        const bytes = Buffer.byteLength(args.content)
        if (bytes > maxBytes) {
          return { success: false, error: `File content exceeds ${maxBytes} byte limit` }
        }

        if (path.endsWith('.py')) {
          const syntaxError = checkPythonSyntax(args.content, path)
          if (syntaxError) return { success: false, error: `Syntax error: ${syntaxError}` }
        }

        const key = `${prefix}${path}`
        await r2Client.putObject(key, args.content)
        await upsertFileRecord(app, projectId, path, key, bytes)
        await embeddingStore.add(projectId, path, args.content)

        return { success: true, data: { path, bytes } }
      }

      case 'edit_file': {
        const path = normalizeProjectPath(args.path)
        if (!path) return { success: false, error: 'Invalid path' }
        if (typeof args.search !== 'string' || typeof args.replace !== 'string') {
          return { success: false, error: 'search and replace must be strings' }
        }

        const key = `${prefix}${path}`
        let original: string
        try {
          original = await r2Client.getObject(key)
        } catch {
          return { success: false, error: `File not found: ${path}` }
        }

        const result = applyEdit(original, args.search, args.replace)
        if (!result.matched) {
          return {
            success: false,
            error: `Search text not found in ${path}. Verify the exact text including whitespace.`
          }
        }

        if (path.endsWith('.py')) {
          const syntaxError = checkPythonSyntax(result.content, path)
          if (syntaxError) {
            return { success: false, error: `Edit would introduce syntax error: ${syntaxError}` }
          }
        }

        await r2Client.putObject(key, result.content)
        await upsertFileRecord(app, projectId, path, key, Buffer.byteLength(result.content))
        await embeddingStore.add(projectId, path, result.content)

        // Re-index modified file into tree-sitter and ChromaDB
        treeSitterIndexer.indexFile(projectId, path, result.content)
        chromaClient.indexFile(projectId, path, result.content).catch(() => {
          // ChromaDB re-index is best-effort
        })

        return { success: true, data: { path, changed: true } }
      }

      case 'list_files': {
        const dir = typeof args.directory === 'string' ? args.directory : ''
        const searchPrefix = `${prefix}${dir}`
        const objects = await r2Client.listObjects(searchPrefix)
        const paths = objects.map(o => o.key.replace(prefix, ''))
        return { success: true, data: { files: paths } }
      }

      case 'delete_file': {
        const path = normalizeProjectPath(args.path)
        if (!path) return { success: false, error: 'Invalid path' }
        if (isProtectedPath(path)) {
          return { success: false, error: `Refusing to delete protected file: ${path}` }
        }

        const key = `${prefix}${path}`
        await r2Client.deleteObject(key)
        const existing = await app.service('files').find({
          query: { projectId, key, $limit: 1 }
        }) as { total: number; data: Array<{ _id: unknown }> }
        if (existing.total > 0) {
          await app.service('files').remove(existing.data[0]._id as string)
        }
        embeddingStore.remove(projectId, path)
        return { success: true, data: { deleted: path } }
      }

      case 'search_codebase': {
        if (typeof args.query !== 'string' || !args.query.trim()) {
          return { success: false, error: 'query must be a non-empty string' }
        }

        const searchService = new CodeSearchService(chromaClient, app)
        const results = await searchService.search(projectId, args.query, 5)

        if (results.length === 0) {
          return { success: true, data: { results: [], message: 'No indexed files found for this project' } }
        }

        return {
          success: true,
          data: {
            results: results.map(r => ({
              path: r.filepath,
              preview: r.content.slice(0, 600),
              score: r.score
            })),
            source: results[0].source
          }
        }
      }

      case 'get_symbols': {
        const path = normalizeProjectPath(args.path)
        if (!path) return { success: false, error: 'Invalid path' }

        // Try tree-sitter index (MongoDB-backed, richer data)
        const indexed = await treeSitterIndexer.getSymbols(projectId, path)
        if (indexed) {
          return { success: true, data: { path, symbols: indexed, source: 'index' } }
        }

        // Fallback: extract directly from file content
        let content: string
        try {
          content = await r2Client.getObject(`${prefix}${path}`)
        } catch {
          return { success: false, error: `File not found: ${path}` }
        }

        const symbols = symbolIndexer.extractSymbols(content, path)
        return { success: true, data: { path, symbols, source: 'live' } }
      }

      case 'add_dependency': {
        if (typeof args.name !== 'string' || !args.name.trim()) {
          return { success: false, error: 'name must be a non-empty string' }
        }

        const reqKey = `${prefix}requirements.txt`
        let current = ''
        try {
          current = await r2Client.getObject(reqKey)
        } catch {
          // File doesn't exist yet — start fresh
        }

        const lines = current.split('\n').filter(l => l.trim())
        const packageName = args.name.split(/[>=<!]/)[0].trim().toLowerCase()
        const alreadyPresent = lines.some(
          l => l.split(/[>=<!]/)[0].trim().toLowerCase() === packageName
        )

        if (alreadyPresent) {
          return {
            success: true,
            data: { added: false, message: `${packageName} is already in requirements.txt` }
          }
        }

        lines.push(args.name.trim())
        const newContent = lines.join('\n') + '\n'
        await r2Client.putObject(reqKey, newContent)

        const reqSize = Buffer.byteLength(newContent)
        await upsertFileRecord(app, projectId, 'requirements.txt', reqKey, reqSize)

        return { success: true, data: { added: true, package: args.name, requirements: lines } }
      }

      case 'run_validation': {
        const objects = await r2Client.listObjects(prefix)
        const pyPaths = objects
          .map(o => o.key.replace(prefix, ''))
          .filter(p => p.endsWith('.py'))
          .slice(0, 50)

        const fileResults = await Promise.all(
          pyPaths.map(async path => {
            try {
              const content = await r2Client.getObject(`${prefix}${path}`)
              return { path, content }
            } catch {
              return null
            }
          })
        )

        const files = fileResults.filter(
          (f): f is { path: string; content: string } => f !== null
        )

        // Lazy-import to avoid circular dependency at module load time
        const { validationQueue } = await import('../../services/redis/queues/queues')
        const job = await validationQueue.add(
          'validate',
          { projectId, files },
          { attempts: 1, removeOnComplete: true }
        )

        return { success: true, data: { jobId: job.id, fileCount: files.length } }
      }

      default:
        return { success: false, error: `Unknown tool: ${name}` }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeProjectPath(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const path = input.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  if (!path) return null
  if (path.startsWith('/')) return null
  if (path.includes('..')) return null
  return path
}

function isProtectedPath(path: string): boolean {
  const normalized = path.toLowerCase()
  const protectedFiles = new Set([
    '.env',
    '.env.local',
    '.env.production',
    '.env.development',
    'package.json',
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock'
  ])
  if (protectedFiles.has(normalized)) return true
  if (normalized.startsWith('.git/')) return true
  return false
}

function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    py: 'python',
    ts: 'typescript',
    js: 'javascript',
    json: 'json',
    md: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    env: 'dotenv',
    toml: 'toml',
    txt: 'text'
  }
  return map[ext ?? ''] ?? 'plaintext'
}

async function upsertFileRecord(
  app: Application,
  projectId: string,
  name: string,
  key: string,
  size: number
): Promise<void> {
  const existing = await app.service('files').find({
    query: { projectId, key, $limit: 1 }
  }) as { total: number; data: Array<{ _id: unknown }> }

  if (existing.total > 0) {
    await app.service('files').patch(existing.data[0]._id as string, {
      size,
      updatedAt: Date.now()
    })
  } else {
    await app.service('files').create({
      projectId,
      name,
      key,
      size,
      fileType: detectLanguage(name)
    })
  }
}

/**
 * Apply a surgical SEARCH/REPLACE to file content.
 * Tries exact match first, then whitespace-normalised fuzzy match.
 */
function applyEdit(
  original: string,
  search: string,
  replace: string
): { matched: boolean; content: string } {
  // Exact match
  const idx = original.indexOf(search)
  if (idx !== -1) {
    return {
      matched: true,
      content: original.substring(0, idx) + replace + original.substring(idx + search.length)
    }
  }

  // Fuzzy match: normalise whitespace per line
  const normalise = (line: string) => line.replace(/[ \t]+/g, ' ').trimEnd()
  const searchLines = search.split('\n').map(normalise)
  const contentLines = original.split('\n')

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const candidate = contentLines.slice(i, i + searchLines.length)
    if (candidate.map(normalise).join('\n') === searchLines.join('\n')) {
      const before = contentLines.slice(0, i).join('\n')
      const after = contentLines.slice(i + searchLines.length).join('\n')
      const joined =
        (before ? before + '\n' : '') + replace + (after ? '\n' + after : '')
      return { matched: true, content: joined }
    }
  }

  return { matched: false, content: original }
}

/**
 * Run python3 -m py_compile on the content via a temp file.
 * Returns an error string on failure, null on success.
 */
function checkPythonSyntax(content: string, filename: string): string | null {
  const tmpPath = join('/tmp', `mockline_ast_${Date.now()}_${Math.random().toString(36).slice(2)}.py`)
  try {
    writeFileSync(tmpPath, content, 'utf8')
    execFileSync('python3', ['-m', 'py_compile', tmpPath], { timeout: 10_000 })
    return null
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'stderr' in err) {
      const raw = (err as { stderr: Buffer }).stderr?.toString?.() ?? ''
      return raw.replace(new RegExp(tmpPath, 'g'), filename).trim() || `Syntax error in ${filename}`
    }
    return `Syntax error in ${filename}`
  } finally {
    try {
      unlinkSync(tmpPath)
    } catch {
      // Ignore cleanup errors
    }
  }
}

