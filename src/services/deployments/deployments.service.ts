import { authenticate } from '@feathersjs/authentication'
import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import { deploymentQueue } from '../redis/queues/queues'

class DeploymentsService extends MongoDBService<any, any, Params, any> {
  constructor(
    options: MongoDBAdapterOptions,
    private readonly app: Application
  ) {
    super(options)
  }

  async create(data: any, params?: Params) {
    const now = Date.now()
    const record = await super.create(
      {
        ...data,
        status: 'queued',
        createdAt: now,
        updatedAt: now
      },
      params
    )

    const queueJob = await deploymentQueue.add(
      'deploy_backend',
      {
        deploymentId: record._id?.toString?.() || record._id,
        projectId: data.projectId,
        target: data.target || 'preview'
      },
      {
        removeOnComplete: false,
        removeOnFail: false,
        attempts: 2,
        backoff: { type: 'fixed', delay: 1000 }
      }
    )

    return {
      ...record,
      jobId: queueJob.id?.toString?.()
    }
  }
}

const getOptions = (app: Application): MongoDBAdapterOptions => ({
  paginate: app.get('paginate'),
  Model: app
    .get('mongodbClient')
    .then(db => db.collection('deployments'))
    .then(async collection => {
      await collection.createIndex({ projectId: 1, createdAt: -1 })
      await collection.createIndex({ status: 1, createdAt: -1 })
      return collection
    })
})

export const deployments = (app: Application) => {
  app.use('deployments', new DeploymentsService(getOptions(app), app), {
    methods: ['find', 'get', 'create', 'patch', 'remove'],
    events: ['queued', 'completed', 'failed']
  })

  app.service('deployments').hooks({
    around: {
      all: [authenticate('jwt')]
    }
  })
}
