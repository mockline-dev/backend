import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions, MongoDBAdapterParams } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import type { Models, ModelsData, ModelsPatch, ModelsQuery } from './models.schema'

export type { Models, ModelsData, ModelsPatch, ModelsQuery }

export interface ModelsParams extends MongoDBAdapterParams<ModelsQuery> {}

export class ModelsService<ServiceParams extends Params = ModelsParams> extends MongoDBService<
  Models,
  ModelsData,
  ModelsParams,
  ModelsPatch
> {}

export const getOptions = (app: Application): MongoDBAdapterOptions => ({
  paginate: app.get('paginate'),
  Model: app
    .get('mongodbClient')
    .then(db => db.collection('models'))
    .then(async (collection: any) => {
      await collection.createIndex({ provider: 1 })
      await collection.createIndex({ isDefault: 1 })
      return collection
    })
})
