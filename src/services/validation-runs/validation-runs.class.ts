import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions, MongoDBAdapterParams } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import type {
  ValidationRuns,
  ValidationRunsData,
  ValidationRunsQuery
} from './validation-runs.schema'

export type { ValidationRuns, ValidationRunsData, ValidationRunsQuery }

export interface ValidationRunsParams extends MongoDBAdapterParams<ValidationRunsQuery> {}

export class ValidationRunsService<
  ServiceParams extends Params = ValidationRunsParams
> extends MongoDBService<ValidationRuns, ValidationRunsData, ValidationRunsParams> {}

export const getOptions = (app: Application): MongoDBAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app
      .get('mongodbClient')
      .then(db => db.collection('validation-runs'))
      .then(async collection => {
        await collection.createIndex({ projectId: 1 })
        await collection.createIndex({ projectId: 1, round: 1 })
        await collection.createIndex({ createdAt: -1 })
        return collection
      })
  }
}
