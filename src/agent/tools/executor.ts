import type { Application } from '../../declarations'
import { r2Client } from '../../storage/r2.client'
import { embeddingStore } from '../rag/store'

export interface ToolResult {
  success: boolean
  data?: any
  error?: string
}

export async function executeToolCall(
  name: string,
  args: Record<string, any>,
  projectId: string,
  app: Application
): Promise<ToolResult> {
  const prefix = `projects/${projectId}/`

  try {
    switch (name) {
      case 'read_file': {
        const path = normalizeProjectPath(args.path)
        if (!path) return { success: false, error: 'Invalid path' }
        const key = `${prefix}${path}`
        const content = await r2Client.getObject(key)
        return { success: true, data: { path, content } }
      }

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

        const key = `${prefix}${path}`
        await r2Client.putObject(key, args.content)

        const existing = await app.service('files').find({
          query: { projectId, key, $limit: 1 }
        })

        if ((existing as any).total > 0) {
          await app.service('files').patch((existing as any).data[0]._id, {
            size: bytes,
            key,
            updatedAt: Date.now()
          })
        } else {
          await app.service('files').create({
            projectId,
            name: path,
            key,
            size: bytes,
            fileType: detectLanguage(path)
          })
        }

        // Index the written file for RAG context retrieval
        await embeddingStore.add(projectId, path, args.content)

        return { success: true, data: { path, bytes } }
      }

      case 'list_files': {
        const searchPrefix = `${prefix}${args.directory || ''}`
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
        })
        if ((existing as any).total > 0) {
          await app.service('files').remove((existing as any).data[0]._id)
        }
        embeddingStore.remove(projectId, path) // Remove only the deleted file from the index
        return { success: true, data: { deleted: path } }
      }

      default:
        return { success: false, error: `Unknown tool: ${name}` }
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

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
  return map[ext || ''] || 'plaintext'
}
