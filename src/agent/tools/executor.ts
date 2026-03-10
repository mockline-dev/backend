import type { Application } from '../../declarations'
import { r2Client } from '../../storage/r2.client'

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
        const key = `${prefix}${args.path}`
        const content = await r2Client.getObject(key)
        return { success: true, data: { path: args.path, content } }
      }

      case 'write_file': {
        const key = `${prefix}${args.path}`
        await r2Client.putObject(key, args.content)

        const existing = await app.service('files').find({
          query: { projectId, key, $limit: 1 }
        })

        if ((existing as any).total > 0) {
          await app.service('files').patch((existing as any).data[0]._id, {
            size: Buffer.byteLength(args.content),
            key,
            updatedAt: Date.now()
          })
        } else {
          await app.service('files').create({
            projectId,
            name: args.path,
            key,
            size: Buffer.byteLength(args.content),
            fileType: detectLanguage(args.path)
          })
        }

        return { success: true, data: { path: args.path, bytes: Buffer.byteLength(args.content) } }
      }

      case 'list_files': {
        const searchPrefix = `${prefix}${args.directory || ''}`
        const objects = await r2Client.listObjects(searchPrefix)
        const paths = objects.map(o => o.key.replace(prefix, ''))
        return { success: true, data: { files: paths } }
      }

      case 'delete_file': {
        const key = `${prefix}${args.path}`
        await r2Client.deleteObject(key)
        const existing = await app.service('files').find({
          query: { projectId, key, $limit: 1 }
        })
        if ((existing as any).total > 0) {
          await app.service('files').remove((existing as any).data[0]._id)
        }
        return { success: true, data: { deleted: args.path } }
      }

      default:
        return { success: false, error: `Unknown tool: ${name}` }
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
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
