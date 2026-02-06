// Projects Service
import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions, MongoDBAdapterParams } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import type { Project, ProjectData, ProjectPatch, ProjectQuery } from './projects.schema'

export type { Project, ProjectData, ProjectPatch, ProjectQuery }

export interface ProjectParams extends MongoDBAdapterParams<ProjectQuery> {}

// By default calls the standard MongoDB adapter service methods but can be customized with your own functionality.
export class ProjectsService<ServiceParams extends Params = ProjectParams> extends MongoDBService<
  Project,
  ProjectData,
  ServiceParams,
  ProjectPatch
> {}

export const getOptions = (app: Application): MongoDBAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app
      .get('mongodbClient')
      .then(db => db.collection('projects'))
      .then(async collection => {
        await collection.createIndex({ userId: 1 })
        await collection.createIndex({ userId: 1, status: 1 })
        await collection.createIndex({ createdAt: -1 })

        return collection
      })
  }
}
