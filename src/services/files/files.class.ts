// Files Service
import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions, MongoDBAdapterParams } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import type { File, FileData, FilePatch, FileQuery } from './files.schema'

export type { File, FileData, FilePatch, FileQuery }

export interface FileParams extends MongoDBAdapterParams<FileQuery> {}

// By default calls the standard MongoDB adapter service methods but can be customized with your own functionality.
export class FilesService<ServiceParams extends Params = FileParams> extends MongoDBService<
  File,
  FileData,
  ServiceParams,
  FilePatch
> {}

export const getOptions = (app: Application): MongoDBAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app
      .get('mongodbClient')
      .then(db => db.collection('files'))
      .then(async collection => {
        await collection.createIndex({ projectId: 1 })
        await collection.createIndex({ projectId: 1, path: 1 })
        await collection.createIndex({ messageId: 1 })
        await collection.createIndex({ r2Key: 1 })
        await collection.createIndex({ createdAt: -1 })

        return collection
      })
  }
}
