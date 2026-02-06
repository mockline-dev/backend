// Messages Service
import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions, MongoDBAdapterParams } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import type { Message, MessageData, MessagePatch, MessageQuery } from './messages.schema'

export type { Message, MessageData, MessagePatch, MessageQuery }

export interface MessageParams extends MongoDBAdapterParams<MessageQuery> {}

// By default calls the standard MongoDB adapter service methods but can be customized with your own functionality.
export class MessagesService<ServiceParams extends Params = MessageParams> extends MongoDBService<
  Message,
  MessageData,
  ServiceParams,
  MessagePatch
> {}

export const getOptions = (app: Application): MongoDBAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app
      .get('mongodbClient')
      .then(db => db.collection('messages'))
      .then(async collection => {
        await collection.createIndex({ projectId: 1 })
        await collection.createIndex({ projectId: 1, createdAt: -1 })
        await collection.createIndex({ createdAt: -1 })

        return collection
      })
  }
}
