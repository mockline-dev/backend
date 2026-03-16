import { authenticate } from '@feathersjs/authentication'
import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'

class VersionsService extends MongoDBService<any, any, Params, any> {}

const getOptions = (app: Application): MongoDBAdapterOptions => ({
  paginate: app.get('paginate'),
  Model: app
    .get('mongodbClient')
    .then(db => db.collection('versions'))
    .then(async collection => {
      await collection.createIndex({ projectId: 1, createdAt: -1 })
      await collection.createIndex({ generationId: 1 })
      return collection
    })
})

export const versions = (app: Application) => {
  app.use('versions', new VersionsService(getOptions(app)), {
    methods: ['find', 'get', 'create', 'patch', 'remove'],
    events: ['created']
  })

  app.service('versions').hooks({
    around: {
      all: [authenticate('jwt')]
    }
  })
}
