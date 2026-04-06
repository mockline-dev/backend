import { createModuleLogger } from '../../logging'
import { r2Client } from '../../storage/r2.client'
import { createSnapshotWithR2 } from '../../services/snapshots/snapshots.class'
import type { SandboxFile } from '../sandbox/types'

const log = createModuleLogger('persist-files')

const FILE_TYPE_MAP: Record<string, string> = {
  py: 'python',
  ts: 'typescript',
  js: 'javascript',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  txt: 'text',
  toml: 'toml',
  env: 'env',
  sh: 'shell',
  html: 'html',
  css: 'css',
}

function inferFileType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return FILE_TYPE_MAP[ext] ?? 'text'
}

export interface PersistFilesResult {
  fileIds: string[]
  snapshotId: string | null
  uploadedCount: number
}

/**
 * Persists sandbox-validated files to R2 and the files service.
 * Creates a snapshot after successful upload.
 * Safe to call multiple times — uses upsert semantics.
 */
export async function persistFiles(
  projectId: string,
  sandboxFiles: SandboxFile[],
  messageId: string | null,
  app: any,
): Promise<PersistFilesResult> {
  if (sandboxFiles.length === 0) {
    return { fileIds: [], snapshotId: null, uploadedCount: 0 }
  }

  log.info('Persisting sandbox files to R2', { projectId, fileCount: sandboxFiles.length })

  const fileIds: string[] = []

  for (const file of sandboxFiles) {
    const r2Key = `projects/${projectId}/${file.path}`
    const content = file.content

    try {
      // Upload to R2
      await r2Client.putObject(r2Key, content)

      // Upsert files service record
      const existing = await app.service('files').find({
        query: { projectId, name: file.path, $limit: 1 },
        paginate: false,
      } as any)

      const fileList = Array.isArray(existing) ? existing : (existing.data ?? [])

      if (fileList.length > 0) {
        const patched = await app.service('files').patch(fileList[0]._id, {
          size: Buffer.byteLength(content, 'utf8'),
          currentVersion: (fileList[0].currentVersion ?? 1) + 1,
          ...(messageId ? { messageId } : {}),
        })
        fileIds.push(patched._id.toString())
      } else {
        const created = await app.service('files').create({
          projectId,
          name: file.path,
          key: r2Key,
          fileType: file.language ?? inferFileType(file.path),
          size: Buffer.byteLength(content, 'utf8'),
          ...(messageId ? { messageId } : {}),
        })
        fileIds.push(created._id.toString())
      }
    } catch (err: unknown) {
      log.error('Failed to persist file', {
        projectId,
        path: file.path,
        error: err instanceof Error ? err.message : String(err),
      })
      // Continue with other files — partial persistence is better than none
    }
  }

  // Create snapshot after all files are persisted
  let snapshotId: string | null = null
  try {
    const latestResult = await app.service('snapshots').find({
      query: { projectId, $sort: { version: -1 }, $limit: 1 },
    })
    const latestData = Array.isArray(latestResult) ? latestResult : (latestResult.data ?? [])
    const nextVersion = (latestData[0]?.version ?? 0) + 1

    const snapshot = await createSnapshotWithR2(app, {
      projectId,
      version: nextVersion,
      label: messageId ? `AI edit v${nextVersion}` : `Auto-generation v${nextVersion}`,
      trigger: messageId ? 'auto-ai-edit' : 'auto-generation',
    })
    snapshotId = snapshot._id?.toString() ?? null
    log.info('Snapshot created', { projectId, snapshotId, version: nextVersion })
  } catch (err: unknown) {
    log.warn('Snapshot creation failed (non-fatal)', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  log.info('File persistence complete', { projectId, persisted: fileIds.length, snapshotId })
  return { fileIds, snapshotId, uploadedCount: fileIds.length }
}
