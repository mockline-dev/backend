import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions, MongoDBAdapterParams } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import type { Sessions, SessionsData, SessionsPatch, SessionsQuery } from './sessions.schema'

export type { Sessions, SessionsData, SessionsPatch, SessionsQuery }

export interface SessionsParams extends MongoDBAdapterParams<SessionsQuery> {}

export class SessionsService<ServiceParams extends Params = SessionsParams> extends MongoDBService<
  Sessions,
  SessionsData,
  SessionsParams,
  SessionsPatch
> {}

export const getOptions = (app: Application): MongoDBAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app
      .get('mongodbClient')
      .then(db => db.collection('sessions'))
      .then(async (collection: any) => {
        await collection.createIndex({ projectId: 1 })
        await collection.createIndex({ userId: 1 })
        await collection.createIndex({ status: 1 })
        await collection.createIndex({ projectId: 1, status: 1 })
        return collection
      })
  }
}
