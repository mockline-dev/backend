// For more information about this file see https://dove.feathersjs.com/guides/cli/service.class.html#database-services
import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions, MongoDBAdapterParams } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
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
    Model: app.get('mongodbClient').then((db) => db.collection('snapshots'))
    .then(async (collection: any) => {
        await collection.createIndex({ projectId: 1 })
        await collection.createIndex({ projectId: 1, version: -1 })
        return collection
      })
  }
}
