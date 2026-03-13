// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'
import { BadRequest } from '@feathersjs/errors'

import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  snapshotsDataResolver,
  snapshotsDataValidator,
  snapshotsExternalResolver,
  snapshotsPatchResolver,
  snapshotsPatchValidator,
  snapshotsQueryResolver,
  snapshotsQueryValidator,
  snapshotsResolver
} from './snapshots.schema'

import { CopyObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { Application, HookContext } from '../../declarations'
import { logger } from '../../logger'
import { SnapshotsService, getOptions } from './snapshots.class'
import { snapshotsMethods, snapshotsPath } from './snapshots.shared'

const SNAPSHOT_KEEP_COUNTS: Record<'auto-generation' | 'auto-ai-edit' | 'manual', number> = {
  'auto-generation': 5,
  'auto-ai-edit': 10,
  manual: 0
}

export * from './snapshots.class'
export * from './snapshots.schema'

function getS3Client(app: Application): S3Client {
  const awsConfig = app.get('aws')
  return new S3Client({
    region: awsConfig.region,
    credentials: {
      accessKeyId: awsConfig.accessKeyId,
      secretAccessKey: awsConfig.secretAccessKey
    },
    endpoint: awsConfig.endpoint
  })
}

// A configure function that registers the service and its hooks via `app.configure`
export const snapshots = (app: Application) => {
  // Register our service on the Feathers application
  app.use(snapshotsPath, new SnapshotsService(getOptions(app)), {
    // A list of all methods this service exposes externally
    methods: snapshotsMethods,
    // You can add additional custom events to be sent to clients here
    events: []
  })
  // Initialize hooks
  app.service(snapshotsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        schemaHooks.resolveExternal(snapshotsExternalResolver),
        schemaHooks.resolveResult(snapshotsResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(snapshotsQueryValidator),
        schemaHooks.resolveQuery(snapshotsQueryResolver)
      ],
      find: [],
      get: [],
      create: [
        async (context: HookContext) => {
          const { projectId, label, trigger } = context.data

          // 1. Get next version number
          const existing = (await context.app.service('snapshots').find({
            query: { projectId, $sort: { version: -1 }, $limit: 1 }
          })) as any
          const existingData = Array.isArray(existing) ? existing : (existing.data ?? [])
          const nextVersion = existingData.length > 0 ? existingData[0].version + 1 : 1
          context.data.version = nextVersion

          // 2. Get all current files for the project
          const filesResult = (await context.app.service('files').find({
            query: { projectId, $limit: 500 }
          })) as any
          const files = Array.isArray(filesResult) ? filesResult : (filesResult.data ?? [])

          if (files.length === 0) {
            logger.info('No files found for snapshot', { projectId, label })
          }

          // 3. Build a lookup of the previous snapshot's file sizes to enable diff snapshots.
          //    Files whose size is unchanged won't be copied — they reference the previous key.
          const prevSnapshotFiles: Record<string, { size: number; r2SnapshotKey: string }> = {}
          if (existingData.length > 0) {
            for (const pf of existingData[0].files ?? []) {
              prevSnapshotFiles[pf.name] = { size: pf.size, r2SnapshotKey: pf.r2SnapshotKey }
            }
          }

          // 4. Copy only changed / new files to R2; reuse previous snapshot key for unchanged ones.
          const snapshotFiles: any[] = []
          const awsConfig = context.app.get('aws')
          const s3Client = getS3Client(context.app)
          let copiedCount = 0
          let reusedCount = 0

          for (const file of files) {
            const prev = prevSnapshotFiles[file.name]
            const snapshotKey = `snapshots/${projectId}/v${nextVersion}/${file.name}`

            // Reuse the previous snapshot's stored file when size is identical (no content change)
            if (prev && prev.size === file.size) {
              snapshotFiles.push({
                fileId: file._id,
                name: file.name,
                key: file.key,
                r2SnapshotKey: prev.r2SnapshotKey,
                size: file.size,
                fileType: file.fileType
              })
              reusedCount++
              continue
            }

            try {
              await s3Client.send(
                new CopyObjectCommand({
                  Bucket: awsConfig.bucket,
                  CopySource: `${awsConfig.bucket}/${file.key}`,
                  Key: snapshotKey
                })
              )
              snapshotFiles.push({
                fileId: file._id,
                name: file.name,
                key: file.key,
                r2SnapshotKey: snapshotKey,
                size: file.size,
                fileType: file.fileType
              })
              copiedCount++
            } catch (err: any) {
              logger.error('Failed to copy file to snapshot', {
                file: file.name,
                projectId,
                version: nextVersion,
                error: err.message
              })
            }
          }

          context.data.files = snapshotFiles
          context.data.totalSize = snapshotFiles.reduce((sum, f) => sum + (f.size ?? 0), 0)
          context.data.fileCount = snapshotFiles.length
          context.data.r2Prefix = `snapshots/${projectId}/v${nextVersion}/`
          context.data.createdAt = Date.now()

          logger.info('Snapshot prepared', {
            projectId,
            version: nextVersion,
            label,
            trigger,
            fileCount: snapshotFiles.length,
            copiedFiles: copiedCount,
            reusedFiles: reusedCount
          })

          return context
        },
        schemaHooks.validateData(snapshotsDataValidator),
        schemaHooks.resolveData(snapshotsDataResolver)
      ],
      patch: [
        async (context: HookContext) => {
          if (context.data?.action !== 'rollback') return context

          const snapshotId = context.id as string
          const snapshot = await context.app.service('snapshots').get(snapshotId)
          const projectId = snapshot.projectId.toString()

          logger.info('Rolling back to snapshot', {
            snapshotId,
            version: snapshot.version,
            projectId
          })

          // 1. Create a safety snapshot of current state before rollback
          try {
            await context.app.service('snapshots').create({
              projectId,
              label: `Before rollback to v${snapshot.version}`,
              trigger: 'auto-ai-edit'
            } as any)
          } catch (err: any) {
            logger.error('Failed to create safety snapshot before rollback', { error: err.message })
          }

          // 2. Stage snapshot files into a temporary restore prefix before touching live files.
          const awsConfig = context.app.get('aws')
          const s3Client = getS3Client(context.app)
          const livePrefix = `projects/${projectId}/`
          const stagedPrefix = `${livePrefix}.restore-tmp/v${snapshot.version}-${Date.now()}/`

          const stageErrors: Array<{ file: string; error: string }> = []
          const stagedFiles: Array<{
            stagedKey: string
            finalKey: string
            name: string
            size: number
            fileType: string
          }> = []

          const toSnapshotRelativePath = (snapshotFile: any) => {
            if (typeof snapshotFile.key === 'string' && snapshotFile.key.startsWith(livePrefix)) {
              return snapshotFile.key.slice(livePrefix.length)
            }
            return snapshotFile.name
          }

          for (const snapshotFile of snapshot.files) {
            const relativePath = toSnapshotRelativePath(snapshotFile)
            const stagedKey = `${stagedPrefix}${relativePath}`
            const finalKey = `${livePrefix}${relativePath}`

            try {
              await s3Client.send(
                new CopyObjectCommand({
                  Bucket: awsConfig.bucket,
                  CopySource: `${awsConfig.bucket}/${snapshotFile.r2SnapshotKey}`,
                  Key: stagedKey
                })
              )
              stagedFiles.push({
                stagedKey,
                finalKey,
                name: snapshotFile.name,
                size: snapshotFile.size,
                fileType: snapshotFile.fileType
              })
            } catch (err: any) {
              stageErrors.push({ file: snapshotFile.name, error: err.message })
              logger.error('Failed to stage file during rollback', {
                file: snapshotFile.name,
                stagedKey,
                error: err.message
              })
            }
          }

          if (stageErrors.length > 0 || stagedFiles.length !== snapshot.files.length) {
            for (const staged of stagedFiles) {
              try {
                await s3Client.send(
                  new DeleteObjectCommand({ Bucket: awsConfig.bucket, Key: staged.stagedKey })
                )
              } catch (cleanupErr: any) {
                logger.error('Failed to cleanup staged file after rollback staging failure', {
                  key: staged.stagedKey,
                  error: cleanupErr.message
                })
              }
            }
            throw new BadRequest(
              `Rollback staging failed: prepared ${stagedFiles.length}/${snapshot.files.length} files.`,
              {
                stagedCount: stagedFiles.length,
                expectedCount: snapshot.files.length,
                stageErrors
              }
            )
          }

          // 3. Promote staged files to live keys and upsert file records
          const currentFilesResult = (await context.app.service('files').find({
            query: { projectId, $limit: 500 }
          })) as any
          const currentFiles = Array.isArray(currentFilesResult)
            ? currentFilesResult
            : (currentFilesResult.data ?? [])
          const currentByKey = new Map<string, any>(currentFiles.map((file: any) => [file.key, file]))

          const restoreErrors: Array<{ file: string; error: string }> = []
          let restoredCount = 0
          const restoredKeys = new Set<string>()

          for (const staged of stagedFiles) {
            try {
              await s3Client.send(
                new CopyObjectCommand({
                  Bucket: awsConfig.bucket,
                  CopySource: `${awsConfig.bucket}/${staged.stagedKey}`,
                  Key: staged.finalKey
                })
              )

              const existingFile = currentByKey.get(staged.finalKey)
              if (existingFile) {
                await context.app.service('files').patch(existingFile._id, {
                  name: staged.name,
                  key: staged.finalKey,
                  fileType: staged.fileType,
                  size: staged.size
                })
              } else {
                await context.app.service('files').create(
                  {
                    projectId: snapshot.projectId,
                    name: staged.name,
                    key: staged.finalKey,
                    fileType: staged.fileType,
                    size: staged.size
                  },
                  { query: {} }
                )
              }

              restoredKeys.add(staged.finalKey)
              restoredCount += 1
            } catch (err: any) {
              restoreErrors.push({
                file: staged.name,
                error: err.message
              })
              logger.error('Failed to promote staged file during rollback', {
                file: staged.name,
                error: err.message
              })
            }
          }

          // 4. Remove stale files not present in target snapshot
          for (const file of currentFiles) {
            if (restoredKeys.has(file.key)) continue
            try {
              await context.app.service('files').remove(file._id)
              await s3Client.send(new DeleteObjectCommand({ Bucket: awsConfig.bucket, Key: file.key }))
            } catch (err: any) {
              restoreErrors.push({
                file: file.name,
                error: err.message
              })
              logger.error('Failed to remove stale file during rollback', {
                file: file.name,
                error: err.message
              })
            }
          }

          // 5. Cleanup staged objects
          for (const staged of stagedFiles) {
            try {
              await s3Client.send(
                new DeleteObjectCommand({ Bucket: awsConfig.bucket, Key: staged.stagedKey })
              )
            } catch (cleanupErr: any) {
              logger.error('Failed to cleanup staged object after rollback', {
                key: staged.stagedKey,
                error: cleanupErr.message
              })
            }
          }

          if (restoredCount !== snapshot.files.length || restoreErrors.length > 0) {
            throw new BadRequest(
              `Rollback failed: restored ${restoredCount}/${snapshot.files.length} files.`,
              {
                restoredCount,
                expectedCount: snapshot.files.length,
                restoreErrors
              }
            )
          }

          // Short-circuit the patch — return rollback result directly
          context.result = {
            success: true,
            restoredVersion: snapshot.version,
            projectId,
            fileCount: restoredCount
          }

          return context
        },
        schemaHooks.validateData(snapshotsPatchValidator),
        schemaHooks.resolveData(snapshotsPatchResolver)
      ],
      remove: [
        async (context: HookContext) => {
          // Only delete R2 objects that are owned by this snapshot's prefix.
          // Diff snapshots may reference files from earlier snapshot prefixes — leave those alone.
          const snapshot = await context.app.service('snapshots').get(context.id as string)
          const awsConfig = context.app.get('aws')
          const s3Client = getS3Client(context.app)
          const ownPrefix = snapshot.r2Prefix ?? `snapshots/${snapshot.projectId}/v${snapshot.version}/`

          for (const file of snapshot.files) {
            // Skip files that are stored in a different snapshot's prefix (diff references)
            if (!file.r2SnapshotKey.startsWith(ownPrefix)) {
              continue
            }
            try {
              await s3Client.send(
                new DeleteObjectCommand({ Bucket: awsConfig.bucket, Key: file.r2SnapshotKey })
              )
            } catch (err: any) {
              logger.error('Failed to delete snapshot R2 file', {
                key: file.r2SnapshotKey,
                error: err.message
              })
            }
          }

          return context
        }
      ]
    },
    after: {
      all: [],
      create: [
        async (context: HookContext) => {
          const snapshot = context.result as any
          const trigger = snapshot?.trigger as 'auto-generation' | 'auto-ai-edit' | 'manual' | undefined
          const keepCount = trigger ? SNAPSHOT_KEEP_COUNTS[trigger] : 0

          if (!trigger || keepCount <= 0) {
            return context
          }

          const projectId = snapshot.projectId?.toString?.() ?? snapshot.projectId
          const snapshotsResult = (await context.app.service('snapshots').find({
            query: {
              projectId,
              trigger,
              $sort: { createdAt: -1 },
              $limit: 200
            }
          })) as any
          const snapshotsData = Array.isArray(snapshotsResult)
            ? snapshotsResult
            : (snapshotsResult.data ?? [])

          if (snapshotsData.length <= keepCount) {
            return context
          }

          const toPrune = snapshotsData.slice(keepCount)
          for (const oldSnapshot of toPrune) {
            try {
              await context.app.service('snapshots').remove(oldSnapshot._id)
            } catch (err: any) {
              logger.error('Failed to auto-prune snapshot', {
                projectId,
                snapshotId: oldSnapshot._id,
                trigger,
                error: err.message
              })
            }
          }

          logger.info('Snapshot auto-pruning completed', {
            projectId,
            trigger,
            keepCount,
            pruned: toPrune.length
          })

          return context
        }
      ]
    },
    error: {
      all: []
    }
  })
}

// Add this service to the service type index
declare module '../../declarations' {
  interface ServiceTypes {
    [snapshotsPath]: SnapshotsService
  }
}
