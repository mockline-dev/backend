import { authenticate } from '@feathersjs/authentication'
import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'

class AgentsService extends MongoDBService<any, any, Params, any> {}

const getOptions = (app: Application): MongoDBAdapterOptions => ({
  paginate: app.get('paginate'),
  Model: app
    .get('mongodbClient')
    .then(db => db.collection('agents'))
    .then(async collection => {
      await collection.createIndex({ projectId: 1, createdAt: -1 })
      await collection.createIndex({ generationId: 1 })
      await collection.createIndex({ step: 1, createdAt: -1 })
      return collection
    })
})

export const agents = (app: Application) => {
  app.use('agents', new AgentsService(getOptions(app)), {
    methods: ['find', 'get', 'create', 'patch', 'remove'],
    events: ['step']
  })

  app.service('agents').hooks({
    around: {
      all: [authenticate('jwt')]
    }
  })
}
