import { authenticate } from '@feathersjs/authentication'
import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import { generationQueue } from '../redis/queues/queues'

interface GenerationData {
  projectId: string
  prompt: string
  userId: string
  model?: string
  generationId?: string
  jobId?: string
  status?: string
  warningCount?: number
  failedAt?: number
  completedAt?: number
  errorMessage?: string
  createdAt?: number
  updatedAt?: number
}

class GenerationsService extends MongoDBService<any, GenerationData, Params, Partial<GenerationData>> {
  constructor(
    options: MongoDBAdapterOptions,
    private readonly app: Application
  ) {
    super(options)
  }

  async create(data: any, params?: Params) {
    const now = Date.now()
    const project = await this.app.service('projects').get(data.projectId)

    if (project.userId?.toString?.() !== data.userId) {
      throw new Error('User does not own this project')
    }

    const record = await super.create(
      {
        ...data,
        status: 'queued',
        createdAt: now,
        updatedAt: now
      },
      params
    )

    const ollamaConfig = this.app.get('ollama')

    const queueJob = await generationQueue.add(
      'generate_backend',
      {
        projectId: data.projectId,
        prompt: data.prompt,
        userId: data.userId,
        model: data.model || ollamaConfig.roleModels?.generator || ollamaConfig.model,
        framework: project.framework,
        language: project.language,
        generationId: record._id?.toString?.() || undefined
      } as any,
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 1500 },
        removeOnComplete: false,
        removeOnFail: false
      }
    )

    await super.patch(record._id, {
      status: 'processing',
      jobId: queueJob.id?.toString?.(),
      updatedAt: Date.now()
    })

    this.app.channel(`projects/${data.projectId}`).send({
      type: 'generation.started',
      payload: {
        generationId: record._id?.toString?.() || record._id,
        projectId: data.projectId,
        jobId: queueJob.id?.toString?.(),
        startedAt: now
      }
    })

    return {
      ...record,
      jobId: queueJob.id?.toString?.(),
      status: 'processing'
    }
  }
}

const getOptions = (app: Application): MongoDBAdapterOptions => ({
  paginate: app.get('paginate'),
  Model: app
    .get('mongodbClient')
    .then(db => db.collection('generations'))
    .then(async collection => {
      await collection.createIndex({ projectId: 1, createdAt: -1 })
      await collection.createIndex({ userId: 1, createdAt: -1 })
      await collection.createIndex({ status: 1 })
      return collection
    })
})

export const generations = (app: Application) => {
  app.use('generations', new GenerationsService(getOptions(app), app), {
    methods: ['find', 'get', 'create', 'patch', 'remove'],
    events: ['started', 'step', 'file', 'completed', 'failed']
  })

  app.service('generations').hooks({
    around: {
      all: [authenticate('jwt')]
    }
  })
}
