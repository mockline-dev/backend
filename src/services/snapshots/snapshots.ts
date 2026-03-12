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

          // 3. Copy each file in R2 to a snapshot path
          const snapshotFiles: any[] = []
          const awsConfig = context.app.get('aws')
          const s3Client = getS3Client(context.app)

          for (const file of files) {
            const snapshotKey = `snapshots/${projectId}/v${nextVersion}/${file.name}`
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
            fileCount: snapshotFiles.length
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
            const currentFilesResult = (await context.app.service('files').find({
              query: { projectId, $limit: 500 }
            })) as any
            const safetyFiles = Array.isArray(currentFilesResult)
              ? currentFilesResult
              : (currentFilesResult.data ?? [])

            await context.app.service('snapshots').create({
              projectId,
              label: `Before rollback to v${snapshot.version}`,
              trigger: 'auto-ai-edit',
              version: snapshot.version,
              files: safetyFiles.map((f: any) => ({
                fileId: f._id,
                name: f.name,
                key: f.key,
                r2SnapshotKey: `snapshots/${projectId}/v${snapshot.version}/${f.name}`,
                size: f.size,
                fileType: f.fileType
              })),
              totalSize: safetyFiles.reduce((sum: number, f: any) => sum + (f.size ?? 0), 0),
              fileCount: safetyFiles.length,
              r2Prefix: `snapshots/${projectId}/v${snapshot.version}`,
              createdAt: Date.now()
            })
          } catch (err: any) {
            logger.error('Failed to create safety snapshot before rollback', { error: err.message })
          }

          // 2. Delete current project files from DB and R2
          const awsConfig = context.app.get('aws')
          const s3Client = getS3Client(context.app)

          const currentFilesResult = (await context.app.service('files').find({
            query: { projectId, $limit: 500 }
          })) as any
          const currentFiles = Array.isArray(currentFilesResult)
            ? currentFilesResult
            : (currentFilesResult.data ?? [])

          for (const file of currentFiles) {
            try {
              await context.app.service('files').remove(file._id)
              await s3Client.send(new DeleteObjectCommand({ Bucket: awsConfig.bucket, Key: file.key }))
            } catch (err: any) {
              logger.error('Failed to remove file during rollback', {
                file: file.name,
                error: err.message
              })
            }
          }

          // 3. Copy snapshot files back to original paths and recreate file records
          const restoreErrors: Array<{ file: string; error: string }> = []
          let restoredCount = 0

          for (const snapshotFile of snapshot.files) {
            try {
              await s3Client.send(
                new CopyObjectCommand({
                  Bucket: awsConfig.bucket,
                  CopySource: `${awsConfig.bucket}/${snapshotFile.r2SnapshotKey}`,
                  Key: snapshotFile.key
                })
              )
              await context.app.service('files').create({
                projectId,
                name: snapshotFile.name,
                key: snapshotFile.key,
                fileType: snapshotFile.fileType,
                size: snapshotFile.size
              })
              restoredCount += 1
            } catch (err: any) {
              restoreErrors.push({
                file: snapshotFile.name,
                error: err.message
              })
              logger.error('Failed to restore file during rollback', {
                file: snapshotFile.name,
                error: err.message
              })
            }
          }

          if (restoredCount === 0 || restoreErrors.length > 0) {
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
          // Delete R2 snapshot copies when a snapshot is removed
          const snapshot = await context.app.service('snapshots').get(context.id as string)
          const awsConfig = context.app.get('aws')
          const s3Client = getS3Client(context.app)

          for (const file of snapshot.files) {
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
      all: []
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
