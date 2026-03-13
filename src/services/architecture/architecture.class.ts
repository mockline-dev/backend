// For more information about this file see https://dove.feathersjs.com/guides/cli/service.class.html#database-services
import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions, MongoDBAdapterParams } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import type {
  Architecture,
  ArchitectureData,
  ArchitecturePatch,
  ArchitectureQuery
} from './architecture.schema'

export type { Architecture, ArchitectureData, ArchitecturePatch, ArchitectureQuery }

export interface ArchitectureParams extends MongoDBAdapterParams<ArchitectureQuery> {}

// By default calls the standard MongoDB adapter service methods but can be customized with your own functionality.
export class ArchitectureService<ServiceParams extends Params = ArchitectureParams> extends MongoDBService<
  Architecture,
  ArchitectureData,
  ArchitectureParams,
  ArchitecturePatch
> {}

export const getOptions = (app: Application): MongoDBAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app
      .get('mongodbClient')
      .then(db => db.collection('architecture'))
      .then(async (collection: any) => {
        await collection.createIndex({ projectId: 1 }, { unique: true })
        return collection
      })
  }
}
