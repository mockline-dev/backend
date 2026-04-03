import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions, MongoDBAdapterParams } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import type {
  Conversations,
  ConversationsData,
  ConversationsPatch,
  ConversationsQuery
} from './conversations.schema'

export type { Conversations, ConversationsData, ConversationsPatch, ConversationsQuery }

export interface ConversationsParams extends MongoDBAdapterParams<ConversationsQuery> {}

export class ConversationsService<
  ServiceParams extends Params = ConversationsParams
> extends MongoDBService<Conversations, ConversationsData, ConversationsParams, ConversationsPatch> {}

export const getOptions = (app: Application): MongoDBAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app
      .get('mongodbClient')
      .then(db => db.collection('conversations'))
      .then(async collection => {
        await collection.createIndex({ projectId: 1 })
        await collection.createIndex({ userId: 1 })
        await collection.createIndex({ projectId: 1, createdAt: -1 })
        return collection
      })
  }
}
