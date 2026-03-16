import { authenticate } from '@feathersjs/authentication'
import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'

class PromptsService extends MongoDBService<any, any, Params, any> {}

const getOptions = (app: Application): MongoDBAdapterOptions => ({
  paginate: app.get('paginate'),
  Model: app
    .get('mongodbClient')
    .then(db => db.collection('prompts'))
    .then(async collection => {
      await collection.createIndex({ key: 1 }, { unique: false })
      await collection.createIndex({ projectId: 1, createdAt: -1 })
      await collection.createIndex({ kind: 1 })
      return collection
    })
})

export const prompts = (app: Application) => {
  app.use('prompts', new PromptsService(getOptions(app)), {
    methods: ['find', 'get', 'create', 'patch', 'remove'],
    events: ['updated']
  })

  app.service('prompts').hooks({
    around: {
      all: [authenticate('jwt')]
    }
  })
}
