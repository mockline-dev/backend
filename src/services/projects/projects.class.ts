// For more information about this file see https://dove.feathersjs.com/guides/cli/service.class.html#database-services
import type { Params } from '@feathersjs/feathers'
import { MongoDBService } from '@feathersjs/mongodb'
import type { MongoDBAdapterParams, MongoDBAdapterOptions } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import type { Projects, ProjectsData, ProjectsPatch, ProjectsQuery } from './projects.schema'

export type { Projects, ProjectsData, ProjectsPatch, ProjectsQuery }

export interface ProjectsParams extends MongoDBAdapterParams<ProjectsQuery> {}

// By default calls the standard MongoDB adapter service methods but can be customized with your own functionality.
export class ProjectsService<ServiceParams extends Params = ProjectsParams> extends MongoDBService<
  Projects,
  ProjectsData,
  ProjectsParams,
  ProjectsPatch
> {}

export const getOptions = (app: Application): MongoDBAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app.get('mongodbClient').then((db) => db.collection('projects'))
  }
}
