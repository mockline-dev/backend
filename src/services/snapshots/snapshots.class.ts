// For more information about this file see https://dove.feathersjs.com/guides/cli/service.class.html#database-services
import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions, MongoDBAdapterParams } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import { r2Client } from '../../storage/r2.client'
import type { Snapshots, SnapshotsData, SnapshotsPatch, SnapshotsQuery } from './snapshots.schema'

export type { Snapshots, SnapshotsData, SnapshotsPatch, SnapshotsQuery }

export interface SnapshotsParams extends MongoDBAdapterParams<SnapshotsQuery> {}

// By default calls the standard MongoDB adapter service methods but can be customized with your own functionality.
export class SnapshotsService<ServiceParams extends Params = SnapshotsParams> extends MongoDBService<
  Snapshots,
  SnapshotsData,
  SnapshotsParams,
  SnapshotsPatch
> {}

export const getOptions = (app: Application): MongoDBAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app
      .get('mongodbClient')
      .then(db => db.collection('snapshots'))
      .then(async (collection: any) => {
        await collection.createIndex({ projectId: 1 })
        await collection.createIndex({ projectId: 1, version: -1 })
        return collection
      })
  }
}

// Helper function to create a snapshot with R2 copy
export async function createSnapshotWithR2(app: Application, data: any): Promise<Snapshots> {
  const snapshotId = data.version?.toString() || Date.now().toString()
  const sourcePrefix = `projects/${data.projectId}/`
  const snapshotPrefix = `snapshots/${data.projectId}/${snapshotId}/`

  // Copy all files in R2 atomically
  await r2Client.copyPrefix(sourcePrefix, snapshotPrefix)

  // Get current file list for metadata
  const filesResult = await app.service('files').find({
    query: { projectId: data.projectId, $limit: 500 }
  })

  const snapshotData: any = {
    ...data,
    r2Prefix: snapshotPrefix,
    fileCount: filesResult.total || 0,
    totalSize: filesResult.data?.reduce((sum: number, f: any) => sum + (f.size || 0), 0) || 0,
    files:
      filesResult.data?.map((f: any) => ({
        fileId: f._id,
        name: f.name,
        key: f.key,
        r2SnapshotKey: `${snapshotPrefix}${f.name}`,
        size: f.size,
        fileType: f.fileType
      })) || []
  }

  return app.service('snapshots').create(snapshotData)
}

// Helper function to restore a snapshot
export async function restoreSnapshot(
  app: Application,
  snapshotId: string
): Promise<{ restored: boolean; snapshotId: string; fileCount: number }> {
  const snapshot: any = await app.service('snapshots').get(snapshotId)
  if (!snapshot) {
    throw new Error('Snapshot not found')
  }

  // Copy snapshot files back to the project prefix
  const destPrefix = `projects/${snapshot.projectId}/`
  await r2Client.copyPrefix(snapshot.r2Prefix, destPrefix)

  // Rebuild file metadata in MongoDB
  await app.service('files').remove(null, {
    query: { projectId: snapshot.projectId }
  })

  for (const file of snapshot.files) {
    await app.service('files').create({
      projectId: snapshot.projectId,
      name: file.name,
      key: `${destPrefix}${file.name}`,
      fileType: file.fileType,
      size: file.size
    })
  }

  await app.service('projects').patch(snapshot.projectId, {
    status: 'ready'
  })

  return { restored: true, snapshotId, fileCount: snapshot.files.length }
}

// Helper function to prune old snapshots
export async function pruneSnapshots(
  app: Application,
  projectId: string,
  keepCount = 10
): Promise<{ pruned: number }> {
  const allResult = await app.service('snapshots').find({
    query: { projectId }
  })

  const toDelete = allResult.data.slice(keepCount)

  for (const old of toDelete) {
    await r2Client.deletePrefix(old.r2Prefix)
    await app.service('snapshots').remove(old._id as any)
  }

  return { pruned: toDelete.length }
}
