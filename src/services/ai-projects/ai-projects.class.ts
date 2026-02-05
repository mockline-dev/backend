// AI Projects Service
import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions, MongoDBAdapterParams } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import type { AIProject, AIProjectData, AIProjectPatch, AIProjectQuery } from './ai-projects.schema'

export type { AIProject, AIProjectData, AIProjectPatch, AIProjectQuery }

export interface AIProjectParams extends MongoDBAdapterParams<AIProjectQuery> {}

// By default calls the standard MongoDB adapter service methods but can be customized with your own functionality.
export class AIProjectsService<ServiceParams extends Params = AIProjectParams> extends MongoDBService<
  AIProject,
  AIProjectData,
  AIProjectParams,
  AIProjectPatch
> {}

export const getOptions = (app: Application): MongoDBAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app
      .get('mongodbClient')
      .then(db => db.collection('ai-projects'))
      .then(async collection => {
        await collection.createIndex({ userId: 1 })
        await collection.createIndex({ userId: 1, status: 1 })
        await collection.createIndex({ conversationId: 1 })
        await collection.createIndex({ createdAt: -1 })

        return collection
      })
  }
}
