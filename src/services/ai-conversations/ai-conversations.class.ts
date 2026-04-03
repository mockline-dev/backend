import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions, MongoDBAdapterParams } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import type {
  AiConversations,
  AiConversationsData,
  AiConversationsPatch,
  AiConversationsQuery
} from './ai-conversations.schema'

export type { AiConversations, AiConversationsData, AiConversationsPatch, AiConversationsQuery }

export interface AiConversationsParams extends MongoDBAdapterParams<AiConversationsQuery> {}

export class AiConversationsService<
  ServiceParams extends Params = AiConversationsParams
> extends MongoDBService<
  AiConversations,
  AiConversationsData,
  AiConversationsParams,
  AiConversationsPatch
> {}

export const getOptions = (app: Application): MongoDBAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app
      .get('mongodbClient')
      .then(db => db.collection('ai-conversations'))
      .then(async collection => {
        await collection.createIndex({ projectId: 1 })
        await collection.createIndex({ projectId: 1, createdAt: -1 })
        await collection.createIndex({ status: 1 })
        return collection
      })
  }
}
