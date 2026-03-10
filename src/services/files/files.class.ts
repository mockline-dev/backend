// For more information about this file see https://dove.feathersjs.com/guides/cli/service.class.html#database-services
import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions, MongoDBAdapterParams } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import type { Files, FilesData, FilesPatch, FilesQuery } from './files.schema'

export type { Files, FilesData, FilesPatch, FilesQuery }

export interface FilesParams extends MongoDBAdapterParams<FilesQuery> {}

// By default calls the standard MongoDB adapter service methods but can be customized with your own functionality.
export class FilesService<ServiceParams extends Params = FilesParams> extends MongoDBService<
  Files,
  FilesData,
  FilesParams,
  FilesPatch
> {}

export const getOptions = (app: Application): MongoDBAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app
      .get('mongodbClient')
      .then(db => db.collection('files'))
      .then(async collection => {
        await collection.createIndex({ projectId: 1 })
        await collection.createIndex({ messageId: 1 })
        await collection.createIndex({ createdAt: -1 })
        await collection.createIndex({ path: 1 })

        return collection
      })
  }
}
