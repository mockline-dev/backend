// AI Files Service
import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions, MongoDBAdapterParams } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import type { AIFile, AIFileData, AIFilePatch, AIFileQuery } from './ai-files.schema'

export type { AIFile, AIFileData, AIFilePatch, AIFileQuery }

export interface AIFileParams extends MongoDBAdapterParams<AIFileQuery> {}

// By default calls the standard MongoDB adapter service methods but can be customized with your own functionality.
export class AIFilesService<ServiceParams extends Params = AIFileParams> extends MongoDBService<
  AIFile,
  AIFileData,
  AIFileParams,
  AIFilePatch
> {}

export const getOptions = (app: Application): MongoDBAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app
      .get('mongodbClient')
      .then(db => db.collection('ai-files'))
      .then(async collection => {
        await collection.createIndex({ projectId: 1 })
        await collection.createIndex({ projectId: 1, path: 1 })
        await collection.createIndex({ r2Key: 1 })
        await collection.createIndex({ createdAt: -1 })

        return collection
      })
  }
}
