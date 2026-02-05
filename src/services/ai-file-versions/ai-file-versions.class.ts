// AI File Versions Service
import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions, MongoDBAdapterParams } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import type {
  AIFileVersion,
  AIFileVersionData,
  AIFileVersionPatch,
  AIFileVersionQuery
} from './ai-file-versions.schema'

export type { AIFileVersion, AIFileVersionData, AIFileVersionPatch, AIFileVersionQuery }

export interface AIFileVersionParams extends MongoDBAdapterParams<AIFileVersionQuery> {}

// By default calls the standard MongoDB adapter service methods but can be customized with your own functionality.
export class AIFileVersionsService<ServiceParams extends Params = AIFileVersionParams> extends MongoDBService<
  AIFileVersion,
  AIFileVersionData,
  AIFileVersionParams,
  AIFileVersionPatch
> {}

export const getOptions = (app: Application): MongoDBAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app
      .get('mongodbClient')
      .then(db => db.collection('ai-file-versions'))
      .then(async collection => {
        await collection.createIndex({ fileId: 1 })
        await collection.createIndex({ fileId: 1, version: -1 })
        await collection.createIndex({ createdAt: -1 })

        return collection
      })
  }
}
