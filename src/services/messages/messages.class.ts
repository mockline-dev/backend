import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions, MongoDBAdapterParams } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import type { Messages, MessagesData, MessagesPatch, MessagesQuery } from './messages.schema'

export type { Messages, MessagesData, MessagesPatch, MessagesQuery }

export interface MessagesParams extends MongoDBAdapterParams<MessagesQuery> {}

export class MessagesService<ServiceParams extends Params = MessagesParams> extends MongoDBService<
  Messages,
  MessagesData,
  MessagesParams,
  MessagesPatch
> {}

export const getOptions = (app: Application): MongoDBAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app
      .get('mongodbClient')
      .then(db => db.collection('messages'))
      .then(async (collection: any) => {
        await collection.createIndex({ projectId: 1 })
        await collection.createIndex({ projectId: 1, createdAt: 1 })
        return collection
      })
  }
}
