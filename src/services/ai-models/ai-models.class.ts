// AI Models Service
import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions, MongoDBAdapterParams } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import type { AIModel, AIModelData, AIModelPatch, AIModelQuery } from './ai-models.schema'

export type { AIModel, AIModelData, AIModelPatch, AIModelQuery }

export interface AIModelParams extends MongoDBAdapterParams<AIModelQuery> {}

// By default calls the standard MongoDB adapter service methods but can be customized with your own functionality.
export class AIModelsService<ServiceParams extends Params = AIModelParams> extends MongoDBService<
  AIModel,
  AIModelData,
  AIModelParams,
  AIModelPatch
> {}

export const getOptions = (app: Application): MongoDBAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app
      .get('mongodbClient')
      .then(db => db.collection('ai-models'))
      .then(async collection => {
        await collection.createIndex({ name: 1 })
        await collection.createIndex({ provider: 1 })
        await collection.createIndex({ enabled: 1 })
        await collection.createIndex({ createdAt: -1 })

        return collection
      })
  }
}
